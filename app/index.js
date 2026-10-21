import { AudioDeviceModule, AudioEngineMuteMode, registerGlobals, setupIOSAudioManagement } from '@livekit/react-native';
import { Platform } from 'react-native';

registerGlobals({ autoConfigureAudioSession: false });

if (Platform.OS === 'ios') {
  const session = { audioCategory: 'playAndRecord', audioCategoryOptions: ['mixWithOthers', 'allowBluetooth', 'allowBluetoothA2DP', 'defaultToSpeaker'], audioMode: 'default' };
  setupIOSAudioManagement(true, { recording: session, recordingWithoutVoiceProcessing: session, playout: session, deactivateOnStop: true });
  try { AudioDeviceModule.setMuteMode(AudioEngineMuteMode.VoiceProcessing).catch(() => {}); } catch {}
}
require('expo-router/entry');
