import sdk, { MediaStreamOptions, ObjectDetector, ScryptedInterface, Setting, SettingValue, VideoCamera } from "@scrypted/sdk";
import { getH264DecoderArgs, getH264EncoderArgs } from "../../../common/src/ffmpeg-hardware-acceleration";
import { SettingsMixinDeviceOptions } from "../../../common/src/settings-mixin";
import { HomekitMixin } from "./homekit-mixin";

const { log, systemManager, deviceManager } = sdk;

export const defaultObjectDetectionContactSensorTimeout = 60;

export class CameraMixin extends HomekitMixin<any> {
    constructor(options: SettingsMixinDeviceOptions<VideoCamera>) {
        super(options);
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings: Setting[] = [];
        const realDevice = systemManager.getDeviceById<ObjectDetector & VideoCamera>(this.id);

        let msos: MediaStreamOptions[] = [];
        try {
            msos = await realDevice.getVideoStreamOptions();
        }
        catch (e) {
        }

        if (msos?.length > 1) {
            settings.push({
                title: 'Live Stream',
                key: 'streamingChannel',
                value: this.storage.getItem('streamingChannel') || msos[0].name,
                description: 'The media stream to use when streaming to HomeKit.',
                choices: msos.map(mso => mso.name),
            });

            settings.push({
                title: 'Live Stream (remote streaming and Apple Watch)',
                key: 'streamingChannelHub',
                value: this.storage.getItem('streamingChannelHub') || msos[0].name,
                description: 'The media stream to use when streaming from outside your home network or to limited capability devices like Apple Watch.',
                choices: msos.map(mso => mso.name),
            });
        }

        const hasMotionSensor = this.storage.getItem('linkedMotionSensor') || this.interfaces.includes(ScryptedInterface.MotionSensor);
        if (hasMotionSensor) {
            if (msos?.length > 1) {
                settings.push({
                    title: 'Recording Stream',
                    key: 'recordingChannel',
                    value: this.storage.getItem('recordingChannel') || msos[0].name,
                    description: 'The prebuffered media stream for HomeKit Secure Video.',
                    choices: msos.map(mso => mso.name),
                });
            }
        }

        settings.push(
            {
                title: 'Linked Motion Sensor',
                key: 'linkedMotionSensor',
                type: 'device',
                deviceFilter: 'interfaces.includes("MotionSensor")',
                value: this.storage.getItem('linkedMotionSensor') || this.id,
                placeholder: this.interfaces.includes(ScryptedInterface.MotionSensor)
                    ? undefined : 'None',
                description: "Set the motion sensor used to trigger HomeKit Secure Video recordings. Defaults to the device provided motion sensor when available.",
            },
        );

        // settings.push({
        //     title: 'H265 Streams',
        //     key: 'h265Support',
        //     description: 'Camera outputs h265 codec streams.',
        //     value: (this.storage.getItem('h265Support') === 'true').toString(),
        //     type: 'boolean',
        // });

        settings.push({
            title: 'HomeKit Transcoding',
            group: 'HomeKit Transcoding',
            key: 'transcodingNotices',
            value: 'WARNING',
            readonly: true,
            description: 'Transcoding audio and video for HomeKit is not recommended. Configure your camera using the camera web portal or app to output the correct HomeKit compatible codecs (h264/aac/2000kbps).',
        });

        settings.push({
            group: 'HomeKit Transcoding',
            key: 'needsExtraData',
            title: 'Add H264 Extra Data',
            description: 'Some cameras do not include H264 extra data in the stream and this causes live streaming to always fail (but recordings may be working). This is a inexpensive video filter and does not perform a transcode. Enable this setting only as necessary.',
            value: (this.storage.getItem('needsExtraData') === 'true').toString(),
            type: 'boolean',
        });

        let showTranscodeArgs = this.storage.getItem('transcodeStreaming') === 'true'
            || this.storage.getItem('transcodeStreamingHub') === 'true';

        if (hasMotionSensor) {
            settings.push({
                title: 'Transcode Recording',
                group: 'HomeKit Transcoding',
                key: 'transcodeRecording',
                type: 'boolean',
                value: (this.storage.getItem('transcodeRecording') === 'true').toString(),
                description: 'Use FFMpeg to transcode recordings to a format supported by HomeKit Secure Video.',
            });

            showTranscodeArgs = showTranscodeArgs || this.storage.getItem('transcodeRecording') === 'true';
        }

        settings.push({
            title: 'Transcode Streaming',
            group: 'HomeKit Transcoding',
            type: 'boolean',
            key: 'transcodeStreaming',
            value: (this.storage.getItem('transcodeStreaming') === 'true').toString(),
            description: 'Use FFMpeg to transcode streaming to a format supported by HomeKit.',
        });

        if (this.interfaces.includes(ScryptedInterface.VideoCameraConfiguration)) {
            let value = this.storage.getItem('hubStreamingMode');
            if (!value) {
                if (this.storage.getItem('dynamicBitrate') === 'true')
                    value = 'Dynamic Bitrate';
                else if (this.storage.getItem('transcodeStreamingHub') === 'true')
                    value = 'Transcode';
            }

            settings.push({
                title: 'Transcode Remote Streaming and Apple Watch',
                group: 'HomeKit Transcoding',
                key: 'hubStreamingMode',
                value: value || 'Disabled',
                choices: [
                    'Disabled',
                    'Transcode',
                    'Dynamic Bitrate',
                ],
                description: 'The transcode options to use when remote streaming or streaming to limited capabilitity devices like Apple Watch. "Transcode" will use FFmpeg to stream a format supported by HomeKit. "Dynamic Bitrate" adjusts the bitrate of the native camera stream on demand to accomodate available bandwidth. Dynamic Bitrate should be used on secondary streams (sub streams), and not the main stream connected to an NVR, as it will reduce the recording quality.',
            });
        }
        else {
            settings.push({
                title: 'Transcode Remote Streaming and Apple Watch',
                group: 'HomeKit Transcoding',
                type: 'boolean',
                key: 'transcodeStreamingHub',
                value: (this.storage.getItem('transcodeStreamingHub') === 'true').toString(),
                description: 'Transcode when remote streaming and streaming to limited capabilitity devices like Apple Watch.',
            });
        }

        if (showTranscodeArgs) {
            const decoderArgs = getH264DecoderArgs();
            const encoderArgs = getH264EncoderArgs();

            settings.push({
                title: 'Video Decoder Arguments',
                group: 'HomeKit Transcoding',
                key: "videoDecoderArguments",
                value: this.storage.getItem('videoDecoderArguments'),
                description: 'FFmpeg arguments used to decode input video.',
                placeholder: '-hwaccel auto',
                choices: Object.keys(decoderArgs),
                combobox: true,
            });
            settings.push({
                title: 'H264 Encoder Arguments',
                group: 'HomeKit Transcoding',
                key: "h264EncoderArguments",
                value: this.storage.getItem('h264EncoderArguments'),
                description: 'FFmpeg arguments used to encode h264 video.',
                placeholder: '-vcodec h264_omx',
                choices: Object.keys(encoderArgs),
                combobox: true,
            });
        }

        if (this.interfaces.includes(ScryptedInterface.AudioSensor)) {
            settings.push({
                title: 'Audio Activity Detection',
                key: 'detectAudio',
                type: 'boolean',
                value: (this.storage.getItem('detectAudio') === 'true').toString(),
                description: 'Trigger HomeKit Secure Video recording on audio activity.',
            });
        }

        if (this.interfaces.includes(ScryptedInterface.ObjectDetector)) {
            try {
                const types = await realDevice.getObjectTypes();
                const classes = types?.classes?.filter(c => c !== 'motion');
                if (classes?.length) {
                    const value: string[] = [];
                    try {
                        value.push(...JSON.parse(this.storage.getItem('objectDetectionContactSensors')));
                    }
                    catch (e) {
                    }

                    settings.push({
                        title: 'Object Detection Sensors',
                        type: 'string',
                        choices: classes,
                        multiple: true,
                        key: 'objectDetectionContactSensors',
                        description: 'Create HomeKit occupancy sensors that detect specific people or objects.',
                        value,
                    });

                    settings.push({
                        title: 'Object Detection Timeout',
                        type: 'number',
                        key: 'objectDetectionContactSensorTimeout',
                        description: 'Duration in seconds the sensor will report as occupied, before resetting.',
                        value: this.storage.getItem('objectDetectionContactSensorTimeout') || defaultObjectDetectionContactSensorTimeout,
                    });
                }

            }
            catch (e) {
            }
        }

        if (this.interfaces.includes(ScryptedInterface.OnOff)) {
            settings.push({
                title: 'Camera Status Indicator',
                description: 'Allow HomeKit to control the camera status indicator light.',
                key: 'statusIndicator',
                value: this.storage.getItem('statusIndicator') === 'true',
                type: 'boolean',
            });
        }

        return [...settings, ...await super.getMixinSettings()];
    }

    async putMixinSetting(key: string, value: SettingValue) {
        if (this.storageSettings.settings[key]) {
            return super.putMixinSetting(key, value);
        }

        if (key === 'videoDecoderArguments') {
            const decoderArgs = getH264DecoderArgs();
            value = decoderArgs[value.toString()]?.join(' ') || value;
        }

        if (key === 'h264EncoderArguments') {
            const encoderArgs = getH264EncoderArgs();
            const args = encoderArgs[value.toString()];
            if (args) {
                // if default args were specified (ie, videotoolbox, quicksync, etc),
                // expand that into args that include bitrate and rescale.
                const extraEncoderArgs = [
                    '-b:v', '${request.video.max_bit_rate * 2}k',
                    '-vf', 'scale=${request.video.width}:${request.video.height}',
                    '-r', '${request.video.fps}',
                ];
                args.push(...extraEncoderArgs);
            }
            const substitute = args?.join(' ');
            value = substitute ? `\`${substitute}\`` : value;
        }

        if (key === 'hubStreamingMode') {
            if (value === 'Dynamic Bitrate') {
                this.storage.setItem('dynamicBitrate', 'true');
                this.storage.removeItem('transcodeStreamingHub');
            }
            else if (value === 'transcodeStreamingHub') {
                this.storage.setItem('transcodeStreamingHub', 'true');
                this.storage.removeItem('dynamicBitrate');
            }
            else {
                this.storage.removeItem('dynamicBitrate');
                this.storage.removeItem('transcodeStreamingHub');
            }
        }

        if (key === 'objectDetectionContactSensors') {
            this.storage.setItem(key, JSON.stringify(value));
        }
        else {
            this.storage.setItem(key, value?.toString());
        }

        if (key === 'detectAudio' || key === 'linkedMotionSensor' || key === 'objectDetectionContactSensors') {
            super.alertReload();
        }

        deviceManager.onMixinEvent(this.id, this.mixinProviderNativeId, ScryptedInterface.Settings, undefined);
    }
}
