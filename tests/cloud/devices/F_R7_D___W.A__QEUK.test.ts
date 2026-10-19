import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/F_R7_D___W.A__QEUK'
import AABBDevice from '@/cloud/devices/aabb_device'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'F_R7_D___W.A__QEUK'
const META: Metadata = { modelId: MODEL_ID, modelName: MODEL_ID, swVersion: '2.9.61' }

// Real captures from an LG V6WD85S2: one Mix cycle at 30 °C / 1000 rpm (dial moved from Cotton to Mix
// before the start), then a second session with Mix at 60 °C / 1200 rpm.

// Current record: Measuring, Mix, 71 min. Previous record: Ready, Cotton, 3:30.
const MEASURING_EC = buf(
    'AA4220EC001C0103300330010000000000000000000000000301000B006400000000001C04010B010B070003070301000000000200000104000B006400000300E0BB',
)
const WASHING_EC = buf(
    'AA4220EC001C04010B010B070003070301000000000200000104000B006400000300001C06003B003B070003070301000000004200000106000B00640000030073BB',
)
const PAUSED_EC = buf(
    'AA4220EC001C06003B003B070003070301000000004200000106000B006400000300001C020031003B070003070301000000004000000102000B006400000300E1BB',
)
const RINSING_EC = buf(
    'AA4220EC001C060031003B070003070301000000000200000106000B006400000300001C070023003B070003070001000000004200000207000B00640000030033BB',
)
// Remote start pressed with the door open. Current record: Error, DE1. Previous record: End of the first cycle.
const ERROR_EC = buf(
    'AA4220EC001C0A0000003B07000000000000000000400000050A000B006400000300001C1200290029070203090601000000000000000312000C00640000030010BB',
)
// A turn of the dial in the Ready state: the current record is Allergy Care, Wash + Dry and Drying in turn
const DIAL_ALLERGY_CARE_EC = buf(
    'AA4220EC001C01021C021C090003050401000000000000000201000C006400000500001C01031803182D00030A0601000000800000000401000C00640000050038BB',
)
const DIAL_WASH_DRY_EC = buf(
    'AA4220EC001C01010C010C120003010601000000000000000301000C006400000200001C01061E061E1300030A0401020000000000000401000C00640000040092BB',
)
const DIAL_DRYING_EC = buf(
    'AA4220EC001C01061E061E1300030A0401020000000000000401000C006400000400001C0100320032180000000000020000000000000601000C0064000000005ABB',
)

// Frames without a status record: door state, and the 0x72 frames sent on start, pause and resume
const OTHER_FRAMES = [buf('AA0720D80CE0BB'), buf('AA09207200C9005BBB'), buf('AA0C2072006403000000FABB')]

// The End record above, alone in a 0xEB frame
const END_EB = AABBDevice.frame(Buffer.concat([Buffer.from([0x20, 0xeb]), ERROR_EC.subarray(4, 34)]))

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev, props: () => ha.devices[DEVICE_ID].properties }
}

describe(MODEL_ID, () => {
    test('start sends the status query', () => {
        const { thinq, dev } = makeDevice()
        dev.start()
        assert.deepEqual(thinq.outbox.map(hex), ['AA0EF0ED1121010000001800B5BB'])
    })

    test('course is read from rec[7]', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', MEASURING_EC)
        assert.equal(props().power, 'ON')
        assert.equal(props().status, 'Measuring')
        assert.equal(props().course, 'Mix')
        assert.equal(props().temp, '30 °C')
        assert.equal(props().spin, '1000 rpm')
        assert.equal(props().remaining_time, 71)
        assert.equal(props().initial_time, 71)
        assert.equal(props().error, 'OFF')
        assert.equal(props().error_message, 'OK')
    })

    test('a wash cycle: washing, paused, rinsing, end', () => {
        const { thinq, props } = makeDevice()

        thinq.emit('data', WASHING_EC)
        assert.equal(props().status, 'Washing')
        assert.equal(props().remaining_time, 59)
        assert.equal(props().initial_time, 59)

        thinq.emit('data', PAUSED_EC)
        assert.equal(props().status, 'Paused')
        assert.equal(props().remaining_time, 49)

        thinq.emit('data', RINSING_EC)
        assert.equal(props().status, 'Rinsing')
        assert.equal(props().remaining_time, 35)
        assert.equal(props().initial_time, 59)
        assert.equal(props().temp, 'Not selected')
        assert.equal(props().spin, '1000 rpm')

        thinq.emit('data', END_EB)
        assert.equal(props().status, 'End')
        assert.equal(props().power, 'ON')
        assert.equal(props().remaining_time, 0)
        assert.equal(props().course, 'Mix')
        assert.equal(props().spin, 'Not selected')
    })

    test('drying mode and steam follow the dial', () => {
        const { thinq, props } = makeDevice()

        thinq.emit('data', DIAL_ALLERGY_CARE_EC)
        assert.equal(props().course, 'Allergy Care')
        assert.equal(props().steam, 'ON')
        assert.equal(props().drying_mode, 'Off')

        thinq.emit('data', DIAL_WASH_DRY_EC)
        assert.equal(props().course, 'Wash + Dry')
        assert.equal(props().steam, 'OFF')
        assert.equal(props().drying_mode, 'Auto')
        assert.equal(props().initial_time, 390)

        thinq.emit('data', DIAL_DRYING_EC)
        assert.equal(props().course, 'Drying')
        assert.equal(props().drying_mode, 'Auto')
        assert.equal(props().temp, 'Not selected')
        assert.equal(props().spin, 'Not selected')
    })

    test('door open error on remote start', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', ERROR_EC)
        assert.equal(props().status, 'Error')
        assert.equal(props().error, 'ON')
        assert.equal(props().error_message, 'Door open error (DE1)')
        assert.equal(props().temp, '60 °C')
        assert.equal(props().spin, '1200 rpm')
        assert.equal(props().remaining_time, 41)
    })

    test('frames without a status record are acknowledged and publish nothing', () => {
        const { thinq, props } = makeDevice()
        const acks = () => thinq.sent.filter((m) => m.cmd === 'ack').map((m) => m.data)
        for (const frame of OTHER_FRAMES) thinq.emit('data', frame)
        assert.deepEqual(props(), {})
        assert.equal(acks().length, OTHER_FRAMES.length)

        // the cloud does not ack status records, see aabb_device.ts
        thinq.emit('data', WASHING_EC)
        assert.equal(acks().length, OTHER_FRAMES.length)
    })
})
