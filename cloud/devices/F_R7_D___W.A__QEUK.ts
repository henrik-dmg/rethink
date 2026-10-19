import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { ERRORS, STATES, COURSES, TEMPERATURES, SPINS, DRYING_MODES } from './washer_common'

// F_R7_D___W.A__QEUK — LG V6WD85S2 washer/dryer combo. Read-only, no commands captured yet.
//
// Same 0x20 0xEB/0xEC framing with 30-byte records as F_C__Y___W.A__QEUK, but the course sits at rec[7]
// (as in the B-generation layout of F_VB_F___W.B_2QEUK), not at rec[12]: the dial moving from Cotton to
// Mix changed rec[7] from 0x01 to 0x07 while rec[12] stayed 0x01. A full turn of the dial confirmed
// rec[13] as the drying mode (Auto only on Wash + Dry and Drying) and rec[16] bit7 as steam (set only
// on the steam courses Allergy Care and Baby Steam Care).
export default class Device extends AABBDevice {
    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, true)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Washer' }),
                components: {
                    power: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-power',
                        state_topic: '$this/power',
                        name: 'Power',
                        icon: 'mdi:washing-machine',
                        device_class: 'running',
                    },
                    status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-status',
                        state_topic: '$this/status',
                        name: 'Status',
                        icon: 'mdi:state-machine',
                        device_class: 'enum',
                        options: STATES.options,
                    },
                    error: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-error',
                        state_topic: '$this/error',
                        name: 'Error',
                        icon: 'mdi:check-circle',
                        device_class: 'problem',
                        entity_category: 'diagnostic',
                    },
                    error_message: {
                        platform: 'sensor',
                        unique_id: '$deviceid-error-message',
                        state_topic: '$this/error_message',
                        name: 'Error message',
                        icon: 'mdi:alert-circle-outline',
                        device_class: 'enum',
                        entity_category: 'diagnostic',
                        options: ERRORS.options,
                    },
                    course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-course',
                        state_topic: '$this/course',
                        name: 'Course',
                        icon: 'mdi:pin-outline',
                        device_class: 'enum',
                        options: COURSES.options,
                    },
                    temp: {
                        platform: 'sensor',
                        unique_id: '$deviceid-temp',
                        state_topic: '$this/temp',
                        name: 'Temperature',
                        device_class: 'enum',
                        options: TEMPERATURES.options,
                    },
                    spin: {
                        platform: 'sensor',
                        unique_id: '$deviceid-spin',
                        state_topic: '$this/spin',
                        name: 'Spin',
                        icon: 'mdi:autorenew',
                        device_class: 'enum',
                        options: SPINS.options,
                    },
                    drying_mode: {
                        platform: 'sensor',
                        unique_id: '$deviceid-drying-mode',
                        state_topic: '$this/drying_mode',
                        name: 'Drying mode',
                        icon: 'mdi:tumble-dryer',
                        device_class: 'enum',
                        options: DRYING_MODES.options,
                    },
                    steam: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-steam',
                        state_topic: '$this/steam',
                        name: 'Steam',
                        icon: 'mdi:kettle-steam',
                    },
                    initial_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-initial_time',
                        state_topic: '$this/initial_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Initial time',
                    },
                    remaining_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-remaining_time',
                        state_topic: '$this/remaining_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Remaining time',
                    },
                },
            }),
        )
    }

    start() {
        // Status query, as sent by F_C__Y___W.A__QEUK and F_VB_F___W.B_2QEUK
        this.send(Buffer.from('F0ED1121010000001800', 'hex'))
    }

    private processRecord(rec: Buffer) {
        const status = rec[2]
        const error = rec[8]

        this.publishProperty('power', status > 0 ? 'ON' : 'OFF')
        this.publishProperty('error_message', ERRORS.map(error)) // publish message before set error state
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', STATES.map(status))
        this.publishProperty('course', COURSES.map(rec[7]))
        this.publishProperty('spin', SPINS.map(rec[10]))
        this.publishProperty('temp', TEMPERATURES.map(rec[11])) // 0x00 from the rinse on
        this.publishProperty('drying_mode', DRYING_MODES.map(rec[13]))
        this.publishProperty('steam', rec[16] & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('remaining_time', rec[3] * 60 + rec[4])
        this.publishProperty('initial_time', rec[5] * 60 + rec[6])
    }

    processAABB(buf: Buffer) {
        this.processCommonStatus(buf, 0x20, 30, this.processRecord)
    }
}
