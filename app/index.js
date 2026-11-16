import { AudioDeviceModule, AudioEngineMuteMode, registerGlobals, setupIOSAudioManagement } from '@livekit/react-native';
import { Platform } from 'react-native';

registerGlobals({ autoConfigureAudioSession: false });

if (Platform.OS === 'ios') {
  // Listening must not take over the phone's audio: music keeps playing and Bluetooth stays in high quality.
  // The microphone setup only applies while talking or in a call.
  const listen = { audioCategory: 'playback', audioCategoryOptions: ['mixWithOthers'], audioMode: 'default' };
  const speak = { audioCategory: 'playAndRecord', audioCategoryOptions: ['mixWithOthers', 'allowBluetooth', 'allowBluetoothA2DP', 'defaultToSpeaker'], audioMode: 'default' };
  setupIOSAudioManagement(true, { recording: speak, recordingWithoutVoiceProcessing: speak, playout: listen, deactivateOnStop: true });
  try { AudioDeviceModule.setMuteMode(AudioEngineMuteMode.VoiceProcessing).catch(() => {}); } catch {}
}
require('expo-router/entry');
