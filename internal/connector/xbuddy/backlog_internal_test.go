package xbuddy

import (
	"fmt"
	"strings"
	"testing"
	"testing/synctest"

	"github.com/stretchr/testify/require"

	"github.com/prusa3d/prusa-connect/sdk/connectorapi"
)

// fullFrame is a telemetry frame in the shape render.cpp in
// Prusa-Firmware-Buddy sends while printing, carrying every key the driver
// reads: each top-level path, the chamber, and for every head each reading of
// the tree shape, its activity and its feeder.
func fullFrame(heads int) []byte {
	tools := make([]string, 0, heads)
	for head := range heads {
		tools = append(tools, fmt.Sprintf(
			`"%d":{"active":%t,"nozzle_temp":215.0,"nozzle_target_temp":215,"print_fan_rpm":3000,`+
				`"heatbreak_fan_rpm":6000,"consumed_weight":12.5,"odometer_id":1,"odometer_e":1234.5,`+
				`"odometer_weight":3.5,"feeder":{"mmu_progress_code":0,"mmu_command_in_progress":"T0"}}`,
			head, head == 0))
	}

	return []byte(`{"state":"PRINTING","job_id":7,"progress":24,"time_printing":600,"time_remaining":1800,` +
		`"temp_bed":100.0,"target_bed":100,"axis_x":120.5,"axis_y":80.25,"axis_z":12.4,"speed":100,"flow":95,` +
		`"chamber":{"temp":38.4,"target_temp":45,"fan_1_rpm":1200,"fan_2_rpm":1180,"fan_pwm_target":40,"led_intensity":80},` +
		`"tools":{` + strings.Join(tools, ",") + `}}`)
}

// A full telemetry frame puts exactly telemetryFrame patches on the queue, and
// the queue holds all of them for a host that has not read yet.
func TestAWholeTelemetryFrameWaitsForTheHost(t *testing.T) {
	t.Parallel()

	for _, model := range []string{"COREONEINDX", "COREONEL-INDX", "XL", "a model with no figures"} {
		t.Run(model, func(t *testing.T) {
			t.Parallel()

			heads, known := headsOf(model)
			if !known {
				heads = mostHeads()
			}

			synctest.Test(t, func(t *testing.T) {
				session := newSession(settings{
					identity: connectorapi.Identity{Vendor: Vendor, Model: model, Serial: "SN-BACKLOG"},
					storage:  defaultStorage,
				})
				defer func() { _ = session.Close() }()

				feed(session, telemetry(t, fullFrame(heads)))
				synctest.Wait()

				queued := 0

				for drained := false; !drained; {
					select {
					case patch := <-session.State():
						if !reservedPath(patch.Path) {
							queued++
						}

						synctest.Wait()
					default:
						drained = true
					}
				}

				require.Zero(t, session.Dropped(), "patches dropped from one frame of %d heads", heads)
				require.Equal(t, telemetryFrame(heads), queued, "patches one frame of %d heads queued", heads)
			})
		})
	}
}

// A printer with one head gets patchBacklog, which bounds how stale its tree
// can grow when the host is behind.
func TestAPrinterWithOneHeadGetsPatchBacklog(t *testing.T) {
	t.Parallel()

	for _, model := range []string{"MK4S", "MK3.9", "CoreOne", "MINI"} {
		require.Equal(t, patchBacklog, patchBacklogFor(model), model)
	}

	require.GreaterOrEqual(t, patchBacklogFor("COREONEINDX"), telemetryFrame(8))
	require.GreaterOrEqual(t, patchBacklogFor("XL"), telemetryFrame(5))
	require.Equal(t, patchBacklogFor("COREONEINDX"), patchBacklogFor("a model with no figures"))
}
