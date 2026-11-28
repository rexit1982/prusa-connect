package xbuddy

import "slices"

const (
	// jobState is the one path a telemetry frame reaches beyond its own keys:
	// the job's state, which reportJobState writes on every frame once a job is
	// named.
	jobState = 1

	// chamberReadings is what the chamber reports outside its block: its
	// temperature and target (chamberTempPath and chamberTargetPath).
	chamberReadings = 2
)

// telemetryFrame is the most state patches one telemetry frame puts on the
// queue for a printer with the given number of heads: every top-level path,
// the job's state, the chamber's temperature, target and block, and every
// reading the tree shape carries for each head. A head's activity and feeder
// are reserved paths and take no room on the queue.
func telemetryFrame(heads int) int {
	chamber := len(chamberPaths) + chamberReadings

	return len(telemetryPaths) + jobState + chamber + heads*len(treeTelemetryMembers)
}

// mostHeads is the most heads any model in headCounts is built with. A model
// this driver has no figures for is sized as that one.
func mostHeads() int {
	most := 1
	for _, sizes := range headCounts {
		most = max(most, slices.Max(sizes))
	}

	return most
}

// patchBacklogFor is how many state patches a session for model may hold for
// the host.
//
// report puts a whole telemetry frame on the queue at once, faster than the
// host takes it off, so the queue holds one full frame of the model's own with
// a quarter on top. An INDX with eight heads sends more than patchBacklog in
// one frame.
//
// It is never smaller than patchBacklog. A printer with one head gets
// patchBacklog, which bounds how stale its tree can grow when the host is
// behind. A model with no figures is sized as the model with the most heads: a
// larger queue costs memory for a few dozen patches, and a smaller one drops
// telemetry on every frame.
func patchBacklogFor(model string) int {
	heads, known := headsOf(model)
	if !known {
		heads = mostHeads()
	}

	frame := telemetryFrame(heads)

	return max(patchBacklog, frame+frame/4)
}
