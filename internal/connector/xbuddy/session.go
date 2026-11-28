package xbuddy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prusa3d/prusa-connect/internal/kernel/lane"
	"github.com/prusa3d/prusa-connect/sdk/connectorapi"
	"github.com/prusa3d/prusa-connect/sdk/fault"
)

// The errors a session reports. Callers inspect them with errors.Is.
var (
	// ErrSessionClosed reports work offered to a printer the host has released.
	ErrSessionClosed = errors.New("xbuddy: the session is closed")
	// ErrQueueFull reports a command offered to a printer already holding as
	// many as it agreed to. The host fails it rather than deepening a queue
	// nobody is draining.
	ErrQueueFull = errors.New("xbuddy: the command queue is full")
	// ErrPrinterWentAway reports a command that reached the printer and lost
	// its connection before an event answered it. It is not resent: the printer
	// may have carried it out, and a second START_PRINT is a second print.
	ErrPrinterWentAway = errors.New("xbuddy: the printer disconnected before answering")
	// ErrCommandDeadline reports a command the printer took and left unanswered
	// for as long as this session waits. It promises no more about what the
	// machine did than ErrPrinterWentAway does, and it carries
	// context.DeadlineExceeded so that a host recording the outcome reads a
	// timeout rather than an unexplained failure.
	ErrCommandDeadline = fmt.Errorf(
		"xbuddy: the printer did not answer inside the command deadline: %w", context.DeadlineExceeded)
	// ErrNoListing reports a printer that accepted SEND_FILE_INFO and answered
	// with no file information, so there is nothing to return and nothing to
	// retry.
	ErrNoListing = errors.New("xbuddy: the printer reported nothing about that path")
)

// The events that make a command a failure. Every other event carrying a
// command id completes it, which is what legacy/connector/xbuddy/connection.go
// does at line 592.
const (
	eventRejected = "REJECTED"
	eventFailed   = "FAILED"
)

// eventAccepted is the first answer to a G-code frame. It completes the
// command for its caller, and it does not free the printer: see running. For
// any other command it answers nothing: see answer.
const eventAccepted = "ACCEPTED"

// patchBacklog is the least number of state patches that may be waiting for
// the host. It is small because the host reads continuously, and it is not
// zero because a printer reporting telemetry at 4 Hz should not wait for each
// frame to be picked up. A printer with several heads sends more than this in
// one frame, and patchBacklogFor sizes its queue.
const patchBacklog = 64

// maxFrameBytes bounds one printer-to-server frame.
const maxFrameBytes = 1 << 20

// defaultCommandDeadline bounds how long one command waits for the event that
// answers it, once its frame is on the wire.
//
// Nothing else bounds that wait. A pong re-arms the read deadline, so a printer
// that answers pings and never answers the command keeps a connection no
// timeout ends. The length is the read deadline's, because a command
// outstanding longer than the silence this dialect already calls a dead printer
// is not going to be answered. The caller is answered when the firmware accepts
// a verb, and the same length then bounds how long the queue is held while an
// accepted G-code command runs. See Session.awaitRunning.
const defaultCommandDeadline = readDeadline

// Session is one printer, which is not the same thing as one websocket.
//
// A printer that drops off the wire keeps its session: commands queue while it
// is away and drain when it comes back, which earlier research records as
// the property most likely to be lost in a rewrite. The host holds one session
// from the first connection until it closes it, and a reconnection reattaches a
// socket to the session that is already there rather than announcing a second
// printer.
type Session struct {
	identity connectorapi.Identity
	caps     connectorapi.Set
	log      *slog.Logger
	// storage is the firmware-side mountpoint a path with no storage segment
	// resolves against. The firmware namespace is absolute and the rest of the
	// product's is not, and this connector is where the leading slash is added.
	storage string

	// chunkCeiling bounds one transfer chunk's payload. See
	// defaultChunkWriteCeiling for what the number is transcribed from.
	chunkCeiling int

	// sends is what this driver may put on the wire for itself, which is not
	// what a caller may ask for. See Driver.sendable.
	sends connectorapi.Set

	// queue carries a command from Do to the pump. See commandQueue.
	queue *commandQueue
	// transferMoved wakes the pump when a transfer begins or ends, so it holds
	// background work from the start of one and sends it after the end.
	transferMoved chan struct{}

	// commandDeadline bounds how long one command waits for the printer to
	// answer it, counted from the moment its frame is written, and how long the
	// queue is held after an accepted G-code command. A command still
	// in the queue is not counted: a printer that is away is waited for,
	// and the caller's context is what ends that wait.
	commandDeadline time.Duration

	// inbox takes patches from whichever reader goroutine is live, and patches
	// is what the host ranges over. patchPump is the only writer to patches, so
	// it has exactly one closer.
	inbox   chan connectorapi.StatePatch
	patches chan connectorapi.StatePatch

	// filled tells patchPump that a reserved slot holds something. It carries
	// one wake-up, because the pump reads every slot each time round.
	filled chan struct{}
	// reservedMu guards reserved. It is a lock of its own because patchPump
	// takes it for every patch and mu is held by the command paths.
	reservedMu sync.Mutex
	// reserved is one slot per dialog path, per tool path INFO writes and per
	// path a tool removal names, holding the newest value for that path until
	// the host takes it. See Session.report, hardwarePath and reportTools.
	reserved map[string]connectorapi.StatePatch

	// refresh carries a request to ask the printer what the print is now. It
	// holds one token and drops the rest, which is the whole of the
	// coalescing: see jobrefresh.go.
	refresh chan struct{}
	// job is the newest job number the printer has named, or jobIDUnknown on a
	// machine that has not named one since this session began. SEND_JOB_INFO
	// takes a required job_id, so a refresh has nothing to ask about until the
	// printer has said which print it means.
	job atomic.Int64
	// machineState is the newest /state the printer reported, and is what makes
	// a state change an edge rather than a level: telemetry restates the same
	// word four times a second.
	machineState atomic.Pointer[string]
	// stateHeard is whether the printer has reported a state on the connection
	// it is on now. A state from before a reconnect is not this printer's
	// answer: it may have started a print from its own screen meanwhile.
	stateHeard atomic.Bool
	// jobState is the word this session last wrote to /job/state, nil before it
	// has written one. It is what lets the end of a print stick: see
	// noteThePrintEnded.
	jobState atomic.Pointer[string]
	// jobOutcome is the word this session last wrote to /job/outcome, nil for a
	// print that has not ended. It is what keeps the first terminal word: see
	// noteThePrintOutcome.
	jobOutcome atomic.Pointer[string]
	// objectsJob is the job number the array at /job/objects belongs to, or
	// jobIDUnknown while the tree holds none. It is what lets a new print
	// clear the array and the same print named again keep it: see
	// cancelobjects.go.
	objectsJob atomic.Int64

	// live is how this session proves a connection is still there.
	live Liveness

	// changed wakes the host when a connection attaches or goes. It holds one
	// wake-up and drops the rest: the host reads the answer from Connected, so a
	// printer bouncing can neither block whichever goroutine noticed nor grow a
	// queue of edges nobody is draining.
	changed chan struct{}

	done      chan struct{}
	closeOnce sync.Once
	onClose   func()
	// onFirmware is the driver's half of reportFirmware.
	onFirmware func(firmware string) bool

	// replacedBy is what the printer said it was when it came back as something
	// this session was not built for, and nil for every other way a session
	// ends. It is written once, before done closes, and read only by a command
	// that has already seen done closed, so the close is what orders the two.
	replacedBy atomic.Pointer[connectorapi.Identity]

	nextID  atomic.Uint32
	dropped atomic.Uint64
	refused atomic.Uint64

	// slotsCleared is set once the first INFO of this session has removed
	// the 1-based /slot paths a tree stored by an earlier release may hold.
	slotsCleared atomic.Bool

	// layout is how the firmware's numbered tools sit on the tool tree, as
	// the last INFO said: one of the toolLayout values. See toolLayoutFor.
	layout atomic.Int32
	// toolBase is where the firmware starts counting tools in a setter key,
	// as the last INFO said: one of the toolBase values. See toolsetter.go.
	toolBase atomic.Int32
	// toolsMu guards the tool fields below it, up to activity.
	toolsMu sync.Mutex
	// soleHead is the one enabled head the last INFO named, and empty when it
	// named several or none. See toolReport.sole.
	soleHead connectorapi.ToolID
	// heldTools is every tool the last INFO wrote and heldPaths every path
	// it gave a value, so the next one removes what it no longer says. Both
	// are nil until an INFO has described the tools.
	heldTools map[connectorapi.ToolID]bool
	heldPaths map[string]bool
	// readings is every tool tree-shaped telemetry has written a reading for,
	// so a null for one of them removes its readings once.
	readings map[connectorapi.ToolID]bool
	// targetHead is the head the top of a numbered toolchanger frame last
	// wrote a nozzle target for, and empty when it wrote none.
	targetHead connectorapi.ToolID
	// activity is what reportActivity last reported.
	activity reportedActivity

	mu sync.Mutex
	// current is the live connection, nil while the printer is away.
	current *link
	// ready is closed when a connection attaches and replaced when one goes, so
	// a command waiting for a printer blocks rather than polls.
	ready chan struct{}
	// inflight is the one command on the wire, keyed by its frame id. It is a
	// map rather than a field because a command whose caller gave up is
	// forgotten while its answer may still arrive.
	inflight map[uint32]*call
	// running is the G-code command the printer accepted and has not finished,
	// nil when there is none. See Session.awaitRunning.
	running *running
	// grace closes the session when the printer has been away for graceDelay.
	// Nil when the configured delay is zero, which means a session outlives any
	// absence and only the host ends it.
	grace      *time.Timer
	graceDelay time.Duration
	// storages is what the printer's newest INFO reported. Empty until it has
	// answered one. The firmware volunteers an INFO when a USB drive is put in
	// or pulled out, and a FILE_CHANGED carries the drive's free space.
	storages []connectorapi.Storage
	// chamberReported is whether the chamber reading in the tree is one this
	// session wrote. Only the telemetry dispatch reads and writes it.
	chamberReported bool
	// storagesReported is whether the connection held now has answered an
	// INFO, and storagesChanged wakes a reader when an INFO moves either.
	storagesReported bool
	storagesChanged  chan struct{}
	// filesChanged carries the file changes the printer volunteers. See
	// Session.FilesChanged.
	filesChanged chan connectorapi.FileChange
	// asking is the SEND_INFO in flight, nil when there is none. See
	// Session.askStorages.
	asking *storagesAsk
	// listing is the newest directory the printer reported, kept for a firmware
	// whose FILE_INFO carries no command id, and listings counts how many have
	// been remembered, which is what dates the one held. See Session.remember.
	listing  connectorapi.Listing
	listings uint64
	// transfer is the one file this host is offering, nil when it is offering
	// none. A device runs one transfer at a time, so this is a field rather than
	// a map: see transfer.go.
	transfer *transfer
	// strayTransfer is the file id of the last transfer the device asked for on
	// this connection while this host held none, and strayTransferKnown is
	// false until there is one. It keeps a stray transfer to one stop.
	strayTransfer      uint32
	strayTransferKnown bool
	// retiredTransfer is what the device called the last transfer this session
	// stopped waiting for, and retiredKnown is false until one whose id was
	// learned has ended. The device's word for that transfer ending can arrive
	// after the next one has been offered, and it is not the next one's.
	retiredTransfer int64
	retiredKnown    bool
	// dialog is the id of the dialog the machine is waiting on and inDialog is
	// whether the state tree currently names one. Both are held so that
	// telemetry repeating the same id at 4 Hz writes one patch rather than four
	// a second. See Session.noteDialog.
	dialog   int64
	inDialog bool
	// dialogFields is what the state tree currently holds about the dialog
	// besides its id, keyed by path and holding the encoded value. It is here
	// for the same reason inDialog is: a field that has not moved is a patch not
	// written, and a field the tree does not hold is one no clear has to remove.
	dialogFields map[string]string
}

// outcome is what one command produced.
type outcome struct {
	result connectorapi.Result
	err    error
}

// call is one command waiting for the printer to answer it.
type call struct {
	id      uint32
	verb    connectorapi.Capability
	frame   []byte
	dropped []string
	// gcode is true for a command that travels as a G or F frame, which the
	// printer goes on running after it has accepted it.
	gcode bool
	// base is the tool numbering a tool setter's key was built with, and
	// toolBaseUnknown for every other verb. See toolBaseMoved.
	base toolBase
	// chamberOff is the M141 S0 frame a chamber target of 0 goes as instead of
	// frame when the printer is quiescent as it is sent, and nil for every
	// other command. See chamberOffForm.
	chamberOff []byte
	// heard closes when the printer's event for this command arrives, whether
	// or not its caller is still waiting.
	heard chan struct{}
	// background marks a command no person is waiting for. It is guarded by
	// the queue's lock and cleared when the command is promoted.
	background bool

	// result carries exactly one outcome and is buffered, so whoever settles
	// the call never blocks on a caller that has already given up.
	result chan outcome
	// settled closes with the result, and is what the pump waits on: the caller
	// takes the value and the pump only needs to know the command is over.
	settled chan struct{}
	once    sync.Once
	// wire moves once from callQueued: to callWritten when the pump is about to
	// write the frame, or to callAbandoned when the caller gave up first. An
	// abandoned call is never written.
	wire atomic.Int32
}

// running is one G-code command the printer accepted and is still carrying out.
//
// The firmware answers a G frame with ACCEPTED, keeps the command until every
// line of it has run, and only then sends FINISHED or FAILED. A command of any
// kind that arrives in between is refused with no reason
// (Prusa-Firmware-Buddy src/connect/planner.cpp, Planner::command), which
// reaches the caller as COMMAND_REFUSED_WITHOUT_REASON.
type running struct {
	id uint32
	// over closes when the printer reports the command ended.
	over chan struct{}
}

// Liveness is how long a connection may say nothing, how often the host asks it
// to say something, and how long that asking may take.
//
// It is the whole of how fast a printer that went away silently is noticed. A
// link that blackholes rather than resets leaves a socket that still accepts
// writes, so the ping proves nothing on its own and ReadDeadline is what turns
// the silence into a disconnection. Detection lands between one deadline less
// one interval and one whole deadline after the printer goes quiet, because the
// deadline was last armed by the frame before it.
//
// The zero value is the shipping connector's numbers, which is what a printer in
// the field is already speaking. A field left at zero takes the shipping one.
type Liveness struct {
	// ReadDeadline is how long a connection may say nothing before it is
	// treated as gone.
	ReadDeadline time.Duration
	// PingInterval is how often the host asks the printer to say something. It
	// sits below ReadDeadline, because the pong is what re-arms the deadline.
	PingInterval time.Duration
	// PingTimeout bounds writing one ping.
	PingTimeout time.Duration
}

func (l Liveness) orShipping() Liveness {
	if l.ReadDeadline <= 0 {
		l.ReadDeadline = readDeadline
	}

	if l.PingInterval <= 0 {
		l.PingInterval = pingInterval
	}

	if l.PingTimeout <= 0 {
		l.PingTimeout = pingTimeout
	}

	return l
}

// settings are what a driver hands one session at birth. They are a struct
// because every field is fixed for the session's life and setting one after the
// pump goroutines have started is a write nothing synchronises.
type settings struct {
	identity        connectorapi.Identity
	caps            connectorapi.Set
	sends           connectorapi.Set
	storage         string
	chunkCeiling    int
	queueDepth      int
	grace           time.Duration
	live            Liveness
	commandDeadline time.Duration
	log             *slog.Logger
	onClose         func()
	onFirmware      func(firmware string) bool
}

func newSession(cfg settings) *Session {
	ceiling := cfg.chunkCeiling
	if ceiling < 1 {
		// A session built with no ceiling still writes chunks the board in the
		// field survives, because that is the case the number was measured for.
		ceiling = defaultChunkWriteCeiling
	}

	deadline := cfg.commandDeadline
	if deadline <= 0 {
		// A session built with no deadline still bounds a command. A caller that
		// set no deadline of its own would otherwise wait for ever.
		deadline = defaultCommandDeadline
	}

	s := &Session{
		identity:        cfg.identity,
		caps:            cfg.caps,
		sends:           cfg.sends,
		storage:         cfg.storage,
		chunkCeiling:    ceiling,
		live:            cfg.live.orShipping(),
		commandDeadline: deadline,
		log:             cfg.log,
		onClose:         cfg.onClose,
		onFirmware:      cfg.onFirmware,
		queue:           newCommandQueue(cfg.queueDepth),
		transferMoved:   make(chan struct{}, 1),
		refresh:         make(chan struct{}, 1),
		inbox:           make(chan connectorapi.StatePatch, patchBacklogFor(cfg.identity.Model)),
		patches:         make(chan connectorapi.StatePatch),
		filled:          make(chan struct{}, 1),
		reserved:        make(map[string]connectorapi.StatePatch, len(dialogPaths)),
		changed:         make(chan struct{}, 1),
		storagesChanged: make(chan struct{}, 1),
		filesChanged:    make(chan connectorapi.FileChange, filesChangedDepth),
		done:            make(chan struct{}),
		ready:           make(chan struct{}),
		inflight:        make(map[uint32]*call),
	}

	if cfg.grace > 0 {
		// Started stopped: the session is built before its first connection
		// attaches, and the grace bounds an absence after one has.
		s.graceDelay = cfg.grace
		s.grace = time.AfterFunc(cfg.grace, func() { _ = s.Close() })
		s.grace.Stop()
	}

	// A machine that has said nothing about a print yet has no job number, and
	// a refresh cannot name one until it does.
	s.job.Store(jobIDUnknown)
	s.objectsJob.Store(jobIDUnknown)

	go s.pump()
	go s.patchPump()
	go s.refreshPump()

	return s
}

// Identity is what the printer said it is in the handshake.
func (s *Session) Identity() connectorapi.Identity { return s.identity }

// Capabilities is the resolved set and its epoch.
//
// The epoch is 1 and never changes. This dialect renegotiates nothing in place:
// a printer whose firmware changed reconnects, and the host resolves it again
// against the profile its new firmware matches.
func (s *Session) Capabilities() (connectorapi.Set, uint64) { return s.caps.Clone(), 1 }

// State is the addressable state tree's update channel. It closes when the
// session does.
func (s *Session) State() <-chan connectorapi.StatePatch { return s.patches }

// Connected reports whether a socket is attached right now.
//
// A session is not a connection here: it outlives an absence so that a command
// queued for a printer that is switched off drains when it comes back (an earlier
// study). A host asking whether the machine is reachable is asking this
// and not whether the session exists.
func (s *Session) Connected() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.current != nil
}

// Peer is the address the printer's socket comes from, and the zero address
// while the printer is away. It is read from the live connection each time,
// so a printer that came back on another address reports the new one.
func (s *Session) Peer() netip.Addr {
	s.mu.Lock()
	current := s.current
	s.mu.Unlock()

	if current == nil {
		return netip.Addr{}
	}

	addr, err := netip.ParseAddrPort(current.conn.RemoteAddr().String())
	if err != nil {
		return netip.Addr{}
	}

	return addr.Addr().Unmap()
}

// PresenceChanged wakes the host when a connection attaches or goes.
//
// It is a wake-up and not an edge, so the host reads Connected afterwards. A
// printer that bounces twice while the host is between two reads has left the
// host one wake-up and the truth, which is what it needs, rather than two edges
// it has to trust the order of.
func (s *Session) PresenceChanged() <-chan struct{} { return s.changed }

// noteChange wakes whoever is watching reachability. It never blocks and never
// queues: a wake-up already waiting says everything a second one would.
func (s *Session) noteChange() {
	select {
	case s.changed <- struct{}{}:
	default:
	}
}

// Do sends one command and waits for the event that answers it.
//
// The arguments were validated against Capabilities and the defaults filled in
// before this was reached, so nothing here re-checks a value this
// driver declared. What it does check is what a descriptor cannot say: whether
// this verb has a wire form at all, and whether the arguments compose into one.
//
// A command offered while the printer is away waits for it rather than failing.
// That is the queue-and-drain rule, and it is bounded by ctx and by the queue
// depth rather than by a printer being present.
//
// A caller whose context is already over is refused before anything reaches the
// wire. The wait at the end reads ctx too, but a select whose cases are both
// ready picks at random, so a command that arrived dead was sent to the printer
// and reported as carried out about half the time it was answered first. That
// is an outcome nobody was waiting for, on a machine the caller had given up
// on. connectorapitest's cancellation clause is what caught it.
func (s *Session) Do(ctx context.Context, cmd connectorapi.Command) (connectorapi.Result, error) {
	if err := ctx.Err(); err != nil {
		return connectorapi.Result{}, fmt.Errorf("xbuddy: %s %w: %w", cmd.Verb, errNotSent, err)
	}

	// A verb reaches the wire when a caller may ask for it, or when this driver
	// is sending it inside an exchange of its own, which is what sends carries.
	// It does not make that second set invokable: the host validates a command
	// against what it resolved, and that is capped at the published baseline.
	form, known := wireTable[cmd.Verb]
	if !known || (!s.caps.Has(cmd.Verb) && !s.sends.Has(cmd.Verb)) {
		return connectorapi.Result{}, connectorapi.CapabilityNotSupported.
			New("the printer does not have that capability").
			With(fault.StringParam("verb", cmd.Verb.String()))
	}

	cmd, answer, answered, err := s.shortNamed(ctx, cmd)
	if answered {
		return answer, err
	}

	pending, err := s.build(cmd, form)
	if err != nil {
		return connectorapi.Result{}, err
	}

	bg := lane.BackgroundOf(ctx)
	pending.background = bg != nil

	if !s.queue.push(pending) {
		// A registered code and not a bare sentinel. The sentinel is kept as the
		// cause, so errors.Is still answers for a caller inside this package,
		// and the refusal now reaches an HTTP caller as a 409 it can retry
		// rather than as core.internal/UNEXPECTED.
		return connectorapi.Result{}, connectorapi.CommandQueueFull.
			New("the printer is already holding as many commands as it takes").
			With(fault.StringParam("verb", cmd.Verb.String())).
			Wrap(ErrQueueFull)
	}

	// A session that closed while this command was being queued has already
	// drained everything it could see, so nothing else will ever settle this
	// one. Settling it here is what stops a command queued into a session that
	// has just ended from waiting for the caller's context to expire.
	//
	// The two orders are both covered. A close that had not run when this reads
	// runs its drain after the send above completed, and finds this command in
	// the queue; a close that had run leaves this read true.
	if s.closed() {
		pending.settle(outcome{err: s.neverSent(cmd.Verb)})
	}

	// There is no case for s.done here on purpose. A command the pump has
	// already written is settled by whoever is waiting for its answer, and a
	// second branch racing that one would tell a caller nothing was sent when
	// something was.
	promoted := bg.Promoted()

	for {
		select {
		case <-promoted:
			s.queue.promote(pending)

			promoted = nil
		case answer := <-pending.result:
			// A verb that moved the print is followed by a request for what the
			// print now is. The firmware volunteers nothing after PAUSE_PRINT,
			// RESUME_PRINT or STOP_PRINT, so this is the only thing that keeps
			// /job/* from holding the reading taken at the start of the print for
			// ever. See jobrefresh.go.
			//
			// A verb the printer refused moved nothing, and a pause refused because
			// there is no print is the commonest refusal there is. Asking after one
			// is a pair of frames spent to be told what the tree already holds.
			if movesThePrint(cmd.Verb) && answer.err == nil && answer.result.OK {
				s.requestJobRefresh()
			}

			return answer.result, answer.err
		case <-ctx.Done():
			return connectorapi.Result{}, pending.giveUp(ctx.Err())
		}
	}
}

// Close releases the session. It is safe to call more than once.
func (s *Session) Close() error {
	s.closeOnce.Do(func() {
		close(s.done)

		s.mu.Lock()
		current := s.current
		s.current = nil

		if s.grace != nil {
			s.grace.Stop()
		}

		s.mu.Unlock()

		s.dropQueued()

		if current != nil {
			current.close()
		}

		if s.onClose != nil {
			s.onClose()
		}
	})

	return nil
}

// build encodes one command into the frame it travels as.
func (s *Session) build(cmd connectorapi.Command, form verb) (*call, error) {
	id := s.nextID.Add(1)

	if err := refuseExcludedValues(cmd); err != nil {
		return nil, err
	}

	values, err := s.wirePaths(cmd)
	if err != nil {
		return nil, err
	}

	args := arguments{verb: cmd.Verb, declared: form.args, values: values}

	frame, base, err := s.encodeFor(id, cmd.Verb, form, args)
	if err != nil {
		return nil, err
	}

	var chamberOff []byte
	if off, is := chamberOffForm(cmd.Verb, form, values); is {
		if chamberOff, err = encodeCommand(id, off, args, base); err != nil {
			return nil, err
		}
	}

	return &call{
		id:         id,
		verb:       cmd.Verb,
		frame:      frame,
		dropped:    suppliedButDropped(form.dropped, cmd.Args),
		gcode:      form.frame == frameGCode || form.frame == frameForced,
		base:       base,
		chamberOff: chamberOff,
		heard:      make(chan struct{}),
		result:     make(chan outcome, 1),
		settled:    make(chan struct{}),
	}, nil
}

// suppliedButDropped is what Result.Ignored carries: the arguments the caller
// actually sent that this verb's wire form does not carry. An argument the
// caller left out was not ignored, it was absent.
func suppliedButDropped(dropped []string, supplied map[string]string) []string {
	var ignored []string

	for _, name := range dropped {
		if _, present := supplied[name]; present {
			ignored = append(ignored, name)
		}
	}

	return ignored
}

// deliver puts one command on the wire and waits for the event that answers it.
func (s *Session) deliver(pending *call) {
	// A command whose caller gave up while it waited in the queue is not sent.
	// The wait can be long, because the pump holds the queue while the printer
	// runs a G-code command, and a move nobody is waiting for any more is not
	// one to start.
	select {
	case <-pending.settled:
		return
	default:
	}

	for {
		current, ok := s.setterLink(pending)
		if !ok {
			// Nothing was written on any connection, so this is the answer that
			// promises the machine never saw it.
			pending.settle(outcome{err: s.neverSent(pending.verb)})

			return
		}

		// After the wait for a connection and not before it: a printer that was
		// away may have started a print meanwhile.
		if err := s.refuseInState(pending.verb); err != nil {
			pending.settle(outcome{err: err})

			return
		}

		// The caller may have given up while the pump waited for a connection.
		if !pending.claimWire() {
			return
		}

		frame := s.frameNow(pending, current)

		s.track(pending)

		if err := current.write(frame); err != nil {
			// It never reached the printer, so the next connection gets it.
			s.forget(pending.id)
			current.close()

			continue
		}

		if s.settledOnWrite(pending) {
			return
		}

		s.awaitAnswer(pending, current)
		s.awaitRunning(pending.id, current)

		return
	}
}

// awaitRunning holds the queue while the printer is still carrying out the
// G-code command it accepted, because it refuses every command until that one
// ends. See running.
//
// The hold is bounded by the command deadline, so a G-code that runs longer,
// or a printer that never says it finished, delays the next command and does
// not stop it. A connection that goes ends the hold too: M999 restarts the
// printer, and a printer that comes back has nothing running.
func (s *Session) awaitRunning(id uint32, current *link) {
	s.mu.Lock()
	held := s.running
	s.mu.Unlock()

	if held == nil || held.id != id {
		return
	}

	defer s.stopRunning(held)

	overdue := time.NewTimer(s.commandDeadline)
	defer overdue.Stop()

	select {
	case <-held.over:
	case <-overdue.C:
	case <-current.gone:
	case <-s.done:
	}
}

// stopRunning forgets a command the pump no longer waits for. An event for it
// that arrives later then finds nothing.
func (s *Session) stopRunning(held *running) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running == held {
		s.running = nil
	}
}

// awaitAnswer waits for the event carrying this command's id, for the deadline,
// for the connection to go, or for the session to close.
func (s *Session) awaitAnswer(pending *call, current *link) {
	// Forgetting on every path is what keeps the map from holding a command
	// whose caller gave up: an event that arrives afterwards then finds nothing
	// rather than a caller that has gone.
	defer s.forget(pending.id)

	// The deadline is this session's own and is not the caller's. A printer that
	// answers pings and never answers the command keeps its connection healthy,
	// so without this the pump holds that one command until whoever sent it
	// gives up, and every command behind it waits with it.
	overdue := time.NewTimer(s.commandDeadline)
	defer overdue.Stop()

	// A G-code command whose caller gave up is still on the printer, so the
	// pump waits for the printer's own answer: an ACCEPTED starts the hold that
	// awaitRunning keeps.
	ending := pending.settled
	if pending.gcode {
		ending = pending.heard
	}

	// The frame is on the wire, so the printer may have carried the command
	// out and gone quiet: a session that ends, a connection that does and a
	// printer that says nothing all read alike. A command that reboots the
	// printer succeeds by dropping the connection.
	select {
	case <-ending:
	case <-overdue.C:
		pending.settle(outcome{err: s.unansweredInTime(pending.verb)})
	case <-current.gone:
		pending.settle(s.connectionEnded(pending))
	case <-s.done:
		pending.settle(s.connectionEnded(pending))
	}
}

// track files a command as the one on the wire.
func (s *Session) track(pending *call) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.inflight[pending.id] = pending
}

// forget drops a command nobody is waiting for any more, so an event that
// arrives late finds nothing rather than a caller that has gone.
func (s *Session) forget(id uint32) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.inflight, id)
}

// answer hands one event to the command waiting for it. An id nothing is
// waiting for is dropped: a printer that answers twice, or answers after the
// pump stopped waiting, has said nothing anybody can act on.
//
// An ACCEPTED for a G-code command also files it as running, and the event
// after it ends that. Both happen under the lock, so a FINISHED that arrives
// before the pump starts to wait is not lost.
func (s *Session) answer(id uint32, event printerEvent, raw json.RawMessage) {
	s.mu.Lock()

	if s.running != nil && s.running.id == id && event.Event != eventAccepted {
		close(s.running.over)
		s.running = nil
	}

	pending, waiting := s.inflight[id]

	// An ACCEPTED says only that the printer took the command: the event after
	// it carries the answer. Buddy firmware sends it for a G-code command alone,
	// and a printer on the Prusa Connect SDK sends it before every answer, so a
	// FILE_INFO arrives after it.
	if waiting && !pending.gcode && event.Event == eventAccepted {
		s.mu.Unlock()

		return
	}

	delete(s.inflight, id)

	if waiting {
		close(pending.heard)
	}

	if waiting && pending.gcode && event.Event == eventAccepted {
		s.running = &running{id: id, over: make(chan struct{})}
	}

	s.mu.Unlock()

	if !waiting {
		return
	}

	pending.settle(resultOf(event, raw, pending.dropped, pending.verb))
}

func (s *Session) closed() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

// patchPump is the only writer to patches, and therefore the only thing that
// closes it. Closing from Close while a reader was writing is the race this
// shape removes rather than guards.
//
// A reserved slot goes before the queue. There is one slot per dialog field and
// they refill only when the dialog moves, so telemetry waits behind a bounded
// number of patches rather than behind a stream.
func (s *Session) patchPump() {
	defer close(s.patches)

	for {
		if patch, waiting := s.takeReserved(); waiting {
			select {
			case s.patches <- patch:
				continue
			case <-s.done:
				return
			}
		}

		select {
		case <-s.done:
			return
		case <-s.filled:
		case patch := <-s.inbox:
			select {
			case s.patches <- patch:
			case <-s.done:
				return
			}
		}
	}
}

// report queues one state patch for the host. It never blocks, and that is the
// whole point: one goroutine reads the socket, so a patch that waited for the
// host would also hold up the event carrying a command's result, and a host
// that is slow to read telemetry would stall every command.
//
// What a full queue costs depends on whether the printer says the thing again.
// Telemetry is a repeating snapshot at 4 Hz, so the oldest patch is dropped and
// the next frame carries what it said. A dialog is repeated by nothing: it is
// written when it moves, and dispatchTelemetry carries the id and no other field
// of it, so a dropped one leaves an operator in front of a machine waiting on a
// question that no reader is told about. Each path in dialogPaths therefore has
// a slot of its own that no backlog evicts, and so has each tool path INFO
// writes, because INFO is not repeated either.
func (s *Session) report(patch connectorapi.StatePatch) {
	if reservedPath(patch.Path) {
		s.reserve(patch)

		return
	}

	select {
	case s.inbox <- patch:
		return
	case <-s.done:
		return
	default:
	}

	select {
	case <-s.inbox:
		s.dropped.Add(1)
	default:
	}

	select {
	case s.inbox <- patch:
	case <-s.done:
	default:
		s.dropped.Add(1)
	}
}

// reserve puts one patch in the slot its path owns, replacing whatever was
// waiting there.
//
// The replacement is what bounds the reserved path: one slot per dialog field
// per printer, so a machine raising a new dialog on every frame costs a fixed
// five values rather than a queue. It is also what the host wants, because a
// path holds one value and the newest is the one on the printer's screen.
func (s *Session) reserve(patch connectorapi.StatePatch) {
	s.reservedMu.Lock()
	s.reserved[patch.Path] = patch
	s.reservedMu.Unlock()

	select {
	case s.filled <- struct{}{}:
	default:
	}
}

// takeReserved removes the next patch waiting in a slot: the dialog first, in
// the order dialogPaths gives, so one dialog reaches the host the same way
// twice, and then the tool paths in path order.
func (s *Session) takeReserved() (connectorapi.StatePatch, bool) {
	s.reservedMu.Lock()
	defer s.reservedMu.Unlock()

	if len(s.reserved) == 0 {
		return connectorapi.StatePatch{}, false
	}

	for _, path := range dialogPaths {
		patch, waiting := s.reserved[path]
		if !waiting {
			continue
		}

		delete(s.reserved, path)

		return patch, true
	}

	first := ""
	for path := range s.reserved {
		if first == "" || path < first {
			first = path
		}
	}

	patch := s.reserved[first]
	delete(s.reserved, first)

	return patch, true
}

// The host reads what this connection has cost through connectorapi.CountsLink.
var _ connectorapi.CountsLink = (*Session)(nil)

// The host reads the printer's address through connectorapi.ReportsPeer.
var _ connectorapi.ReportsPeer = (*Session)(nil)

// Dropped is how many state patches were discarded because the host was not
// reading them. It is a counter rather than a log line per patch, because the
// condition it reports repeats four times a second.
//
// A dialog is never among them. Session.report holds one slot per dialog field
// that the queue cannot evict, so this number counts the paths a later frame
// repeats and nothing else.
func (s *Session) Dropped() uint64 { return s.dropped.Load() }

// Refused is how many frames the printer sent that this dialect could not read
// and dropped.
//
// It is the symptom of a firmware speaking something this build does not, and
// it is a counter for the same reason Dropped is: the condition repeats at
// whatever rate the printer sends. A printer that is connected, is counting up
// here and is reporting no telemetry is one whose frames are all being refused,
// which no other observation separates from a printer with nothing to say. The
// log carries the first refusal of each connection and the total when it ends,
// so this is the live number and the log is the record.
//
// A frame this dialect reads and declines to serve is not counted. A block
// request for a file this host is not holding is not counted, and neither is one
// dropped because the range before it is still being written or because the
// printer has retired it: the printer retries a block request, so counting any of
// them would make the number rise on a healthy transfer, which is the same defect
// as not counting an unreadable frame. A block request whose numbers this wire
// cannot express is counted, because it is a frame the dialect could not read.
func (s *Session) Refused() uint64 { return s.refused.Load() }

// settle records the one outcome of a command. A printer that answers the same
// id twice, or answers after the caller gave up, changes nothing.
func (c *call) settle(answer outcome) {
	c.once.Do(func() {
		c.result <- answer
		close(c.settled)
	})
}

// encodeCommand renders one command as the frame the firmware receives. base
// is where the firmware starts counting tools, and only a tool setter reads it.
func encodeCommand(id uint32, form verb, args arguments, base toolBase) ([]byte, error) {
	if form.gcode != nil {
		code, err := form.gcode(args)
		if err != nil {
			return nil, err
		}

		return encodeFrame(form.frame, id, []byte(code)), nil
	}

	kwargs, err := args.wireKwargs(form, base)
	if err != nil {
		return nil, err
	}

	payload, err := encodeJSONCommand(form.command, kwargs)
	if err != nil {
		return nil, err
	}

	return encodeFrame(form.frame, id, payload), nil
}

// resultOf reads one event as a command outcome. REJECTED and FAILED are the
// two that make a command unsuccessful; every other event carrying the id
// completes it. The two are not the same outcome and they leave in different
// shapes: a REJECTED is a refusal, which is a result carrying its code, and a
// FAILED is an error. connectorapi.Result carries that rule.
//
// A refusal carries machine_reason where the firmware sent one, because that is
// the value a caller compares: it is what tells a caller that REJECTED means
// "this file is already here", which is answered by printing that file rather
// than by abandoning the request. Where the firmware sent only reason, the
// sentence is carried instead, because the alternative is a caller holding "not
// accepted" and nothing else while the printer had already said why. The
// shipping connector reads the pair the same way
// (legacy/connector/xbuddy/connection.go:595).
//
// Where the firmware sent no word at all the dialect says the one thing it does
// know, which is BUG-005: the device refused, and it gave no reason. That is
// said in a registered code and not in the machine reason, because the machine
// reason is the printer's own words and there were none. A sentence written
// here and put in that field would be this host's prose in a field a client is
// told not to branch on, and it reads to an operator as something the firmware
// said.
//
// A refusal the firmware did explain carries a code as well, so a caller can
// branch on a code for every refusal rather than on the absence of one. The
// code says the class of the answer and the machine reason carries the word,
// unchanged.
func resultOf(
	event printerEvent, raw json.RawMessage, dropped []string, verb connectorapi.Capability,
) outcome {
	answer := connectorapi.Result{OK: true, Raw: raw, Ignored: dropped}

	if event.Event != eventRejected && event.Event != eventFailed {
		return outcome{result: answer}
	}

	answer.OK = false

	answer.MachineReason = event.MachineReason
	if answer.MachineReason == "" {
		answer.MachineReason = event.Reason
	}

	if event.Event == eventRejected {
		answer.FaultCode = refusalCode(answer.MachineReason).String()

		return outcome{result: answer}
	}

	return outcome{result: answer, err: failureOf(answer.MachineReason, verb)}
}

// refusalCode is the registered code for one REJECTED, which is the class of
// the answer where the machine reason is the detail. A firmware that refused
// without a word still refused, and the code is the only thing that separates
// "wait and send it again" from "this will never work".
func refusalCode(reason string) fault.Code {
	if reason == "" {
		return connectorapi.CommandRefusedWithoutReason.Code()
	}

	return connectorapi.CommandRefused.Code()
}

// failureOf is the error for one FAILED, which is a command the printer took
// and could not finish.
//
// It is an error and a refusal is not, because what a caller does next differs:
// nothing happened on a refusal, so sending it again is a first attempt, and
// something may have happened here, so it is not. Giving both the refusal's
// shape stored a machine that tried and failed as one that declined, which is
// the one thing this side knows it was not.
func failureOf(reason string, verb connectorapi.Capability) error {
	params := []fault.Param{fault.StringParam("verb", verb.String())}
	if reason != "" {
		params = append(params, fault.StringParam("machine_reason", reason))
	}

	if reason == "" {
		return connectorapi.CommandFailedWithoutReason.
			New("the printer took the command, could not carry it out, and gave no reason for it").
			With(params...)
	}

	return connectorapi.CommandFailed.
		New("the printer took the command and could not carry it out").
		With(params...)
}
