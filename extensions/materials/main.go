// Command materials is a module with both halves: this process, which serves
// the routes below, and a browser bundle under ui/, which draws on them.
//
// # The routes
//
//	GET    /catalogue                  whether a catalogue is loaded, and the import
//	POST   /catalogue/download         download and import the catalogue in the background
//	GET    /catalogue/brands           the catalogue brands
//	GET    /types                      the material types, for the type filter
//	GET    /materials                  one page of materials
//	GET    /materials/{uuid}           one material
//	GET    /materials/{uuid}/spools    its spools
//	POST   /custom-materials           make a custom material
//	PATCH  /custom-materials/{uuid}    replace a custom material
//	DELETE /custom-materials/{uuid}    delete a custom material
//	PUT    /favourites/{uuid}          star a material
//	DELETE /favourites/{uuid}          unstar a material
//	GET    /locations                  the places spools are kept, with their spools
//	POST   /locations                  make a location, or answer the one with that name
//	PATCH  /locations/{id}             rename a location
//	DELETE /locations/{id}             delete a location; its spools keep none
//	GET    /list-filters               the list filters the caller kept
//	PUT    /list-filters               keep the caller's list filters
//	POST   /spools                     add spools
//	PATCH  /spools/{id}                change a spool
//	DELETE /spools/{id}                delete a spool
//	POST   /spools/delete              delete the listed spools, all or none
//	GET    /printers                   the printers, and whether the caller may operate each
//	GET    /printers/{device}/tools    a printer's tools, with what is on each
//	PUT    /printers/{device}/tools/{tool}  assign a material or a spool to a tool
//	DELETE /printers/{device}/tools/{tool}  unassign a tool
//	POST   /printers/{device}/tools/{tool}/spool  add the spool the printer read off its NFC tag
//	POST   /spools/{id}/merge          merge a spool added by hand into the one a printer read
//
// Each path is relative to the mount, so a caller reaches the list at
// /api/v1/modules/com.github.aux.prusa3d.materials/materials. The host decides who may call it
// and then makes the call: view_resource on the instance for a read,
// operate_resource for a write. A change to a printer tool also takes operate
// on that printer, which the module asks the host as the caller. The handlers
// are in internal/routes.
//
// # Following the printers
//
// Once configured, the process reads every printer and the host's event stream
// as itself, under the observe permission module.yaml asks for.
// internal/printers applies what each printer reports of its tools to the
// assignments.
//
// # Settings
//
// module.yaml declares every setting this module reads, each with its type, its
// default and one sentence saying what it controls. The host merges the
// operator's config block over those defaults and sends the result on
// plugin.configure before the first request arrives. Nothing here reads an
// environment variable: a setting an operator cannot see in the manifest is a
// setting nobody can find.
//
// # Errors
//
// internal/routes/codes.go lists every error code of this module. The module
// answers a request it cannot serve with one of those codes and its English
// title. It never answers with a sentence alone, because a caller cannot check
// one.
//
// # Installing it
//
//	sh install.sh
//
// README.md says what that runs and why every change is a new install.
package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"time"

	// The two drivers the database may need. sdk/moduledb imports none.
	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"

	"github.com/prusa3d/prusa-connect/sdk/accessapi"
	"github.com/prusa3d/prusa-connect/sdk/busapi"
	"github.com/prusa3d/prusa-connect/sdk/deviceapi"
	"github.com/prusa3d/prusa-connect/sdk/extension"
	"github.com/prusa3d/prusa-connect/sdk/moduledb"
	"github.com/prusa3d/prusa-connect/sdk/routesapi"
	"github.com/prusa3d/prusa-connect/sdk/wire"
	"github.com/prusa3d/prusa-connect/sdk/wirerpc"

	"github.com/prusa3d/materials/internal/importer"
	"github.com/prusa3d/materials/internal/notify"
	"github.com/prusa3d/materials/internal/printers"
	"github.com/prusa3d/materials/internal/routes"
	"github.com/prusa3d/materials/internal/settings"
	"github.com/prusa3d/materials/internal/stock"
)

// What this child reports when the host asks it what it is. The name is the
// manifest's, and the host holds the two to each other.
const (
	name    = "materials"
	release = extension.Version("0.2.7")
)

// Settings is what an operator writes under this instance's config block. The
// host merges it over the defaults module.yaml declares and sends the result on
// plugin.configure. A key this struct does not carry refuses the start, so a
// typo is found before a request is.
type Settings struct {
	// MaxSpools is how many spools the module holds before it refuses another.
	MaxSpools int `json:"max_spools"`
	// CatalogueURL is the https address the catalogue ZIP is downloaded from.
	CatalogueURL string `json:"catalogue_url"`
	// CatalogueCA is a PEM file the download trusts beside the system roots.
	CatalogueCA string `json:"catalogue_ca"`
}

// openAPI is the fragment describing the route, with every path relative to
// the mount. The host holds it to routesapi.ParseFragment at launch and serves
// it rebased under the namespace, which is what cmd/generate-client-sdk reads
// to type this module's surface.
//
//go:embed openapi.json
var openAPI []byte

// migrations is the schema, one directory per engine, because the operator
// chooses the engine.
//
//go:embed migrations/sqlite/* migrations/postgres/*
var migrations embed.FS

// schema is what sdk/moduledb applies.
//
//nolint:gochecknoglobals // a fixed description of the embedded files.
var schema = moduledb.Schema{Migrations: migrations}

// errNoDatabase refuses a start without a database grant: the module has
// nowhere to keep anything, and would refuse every request.
var errNoDatabase = errors.New("the operator granted this module no database. Approve its needs.database request")

// The catalogue download: at most 64 MiB, in at most five minutes.
const (
	downloadMax     = 64 << 20
	downloadTimeout = 5 * time.Minute
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", name, err)
		os.Exit(1)
	}
}

// run writes the handshake line and then serves frames until the host closes
// the channel.
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	line, err := wire.Handshake{
		Protocol: wire.ProtocolMajor,
		MinMinor: wire.MinMinor,
		MaxMinor: wire.MaxMinor,
		Address:  wire.StdioAddress,
	}.Line()
	if err != nil {
		return fmt.Errorf("render the handshake: %w", err)
	}

	if _, err = os.Stdout.WriteString(line); err != nil {
		return fmt.Errorf("write the handshake: %w", err)
	}

	live := &settings.Live{}

	opened := &database{}
	defer opened.close()

	// The method set is filled after the session exists, because the
	// follower calls the host's device and bus doors on it.
	serves := wirerpc.Methods{}

	conn, err := wirerpc.NewConn(stdio{}, wirerpc.Options{Role: wirerpc.RoleChild, Methods: serves})
	if err != nil {
		return fmt.Errorf("build the session: %w", err)
	}

	maps.Copy(serves, methods(live, opened, conn))

	// The pid is here because the host's log is the only place a person sees
	// this process. Nothing on the wire carries it.
	fmt.Fprintf(os.Stderr, "%s %s is serving on stdio as pid %d\n", name, release, os.Getpid())

	if err = conn.Serve(ctx); err != nil {
		return fmt.Errorf("serve: %w", err)
	}

	return nil
}

// methods is the lifecycle set every child answers, plus the one call that
// carries this module's own HTTP surface.
func methods(live *settings.Live, opened *database, conn *wirerpc.Conn) wirerpc.Methods {
	return wirerpc.Methods{
		wirerpc.MethodInfo: func(context.Context, wirerpc.Call) (any, error) {
			return routesapi.Describe(
				wirerpc.Info{
					Name:     name,
					Version:  release,
					Contract: wirerpc.Contract,
					// Naming the call is what asks the host for the settings. A
					// module that names none is never configured.
					Serves: []wirerpc.Method{wirerpc.MethodConfigure},
				}, openAPI)
		},
		// The settings the host merged from module.yaml's defaults and this
		// instance's config block, and the database the operator granted. The
		// database is opened and migrated here, so the module reports ready
		// only on a schema it has applied.
		wirerpc.MethodConfigure: wirerpc.ConfigureReporting(
			func(ctx context.Context, sent Settings, grants wirerpc.Grants) (wirerpc.Configured, error) {
				if err := live.Set(settings.Values{MaxSpools: sent.MaxSpools}); err != nil {
					return wirerpc.Configured{}, err
				}

				if grants.Database == nil {
					return wirerpc.Configured{}, errNoDatabase
				}

				client, err := catalogueClient(sent.CatalogueCA)
				if err != nil {
					return wirerpc.Configured{}, err
				}

				// The data directory is on disk, where /tmp may be a tmpfs in memory.
				fetch := importer.Download(client, sent.CatalogueURL, downloadMax, grants.Data)

				db, report, err := moduledb.Open(ctx, *grants.Database, schema)
				if err != nil {
					// The cause first: the host shows this line where it may
					// be cut short. The grant's String leaves the password out.
					return wirerpc.Configured{}, fmt.Errorf("%w (the database is %s)", err, grants.Database)
				}

				store := stock.New(db, grants.Database.Engine)
				imports := importer.New(store, time.Now)
				log := slog.New(slog.NewTextHandler(os.Stderr, nil))
				follower := printers.New(deviceapi.NewClient(conn),
					func(ctx context.Context, p busapi.SubscribeParams, onWindow func(busapi.Window) error) error {
						return busapi.Subscribe(ctx, conn, p, onWindow)
					}, store, log)
				// Every change the store commits is told to other modules.
				notifier := notify.New(busapi.NewClient(conn), store, log)
				store.Watch(notifier)
				opened.swap(
					db,
					imports,
					routes.New(
						store,
						imports,
						fetch,
						live,
						follower,
						deviceapi.NewClient(conn),
						accessapi.NewClient(conn),
					),
					func(ctx context.Context) { _ = follower.Run(ctx) },
					notifier.Run,
				)
				// The swap waited for the old import, so a download left here is nobody's.
				importer.Sweep(grants.Data)

				fmt.Fprintf(os.Stderr, "%s keeps its data in %s at schema version %d\n",
					name, grants.Database, report.Version)

				return wirerpc.Configured{Database: report.State()}, nil
			}),
		wirerpc.MethodShutdown: func(context.Context, wirerpc.Call) (any, error) {
			fmt.Fprintf(os.Stderr, "%s was asked to stop\n", name)

			opened.close()

			return nil, nil
		},
		routesapi.MethodServe: routesapi.Serve(opened),
	}
}

// database is the handle plugin.configure opened, the importer that writes
// to it, the routes it serves, and what runs beside them: the follower of the
// printers and the notifier of changes. A second configure replaces them all:
// an import or a runner still at work on the old handle is stopped before it
// is closed.
type database struct {
	mu      sync.Mutex
	db      *sql.DB
	imports *importer.Importer
	served  http.Handler
	// stopRunning stops the runners and waits for them to end.
	stopRunning func()
}

func (d *database) swap(next *sql.DB, imports *importer.Importer, served http.Handler,
	runners ...func(context.Context),
) {
	ctx, cancel := context.WithCancel(context.Background())

	var running sync.WaitGroup

	for _, run := range runners {
		running.Go(func() { run(ctx) })
	}

	stop := func() { cancel(); running.Wait() }

	d.mu.Lock()
	old, oldImports, oldRunning := d.db, d.imports, d.stopRunning
	d.db, d.imports, d.served, d.stopRunning = next, imports, served, stop
	d.mu.Unlock()

	if oldRunning != nil {
		oldRunning()
	}

	if oldImports != nil {
		oldImports.Close()
	}

	if old != nil {
		_ = old.Close()
	}
}

func (d *database) close() { d.swap(nil, nil, nil) }

// ServeHTTP hands the request to the routes on the open database. The host
// configures before the first request, so none arrives before them.
func (d *database) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	served := d.served
	d.mu.Unlock()

	if served == nil {
		served = routes.Unconfigured
	}

	served.ServeHTTP(w, r)
}

// stdio is the pair the host handed over. Close shuts the reading half, which
// is what ends a session whose host has gone quiet.
type stdio struct{}

func (stdio) Read(p []byte) (int, error)  { return os.Stdin.Read(p) }
func (stdio) Write(p []byte) (int, error) { return os.Stdout.Write(p) }
func (stdio) Close() error                { return os.Stdin.Close() }
