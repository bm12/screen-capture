export const iceServers: RTCIceServer[] = [
  { urls: 'stun:stun.services.mozilla.com' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.ekiga.net' },
  { urls: 'stun:stun.fwdnet.net' },
  { urls: 'stun:stun.ideasip.com' },
  { urls: 'stun:stun.iptel.org' },
  { urls: 'stun:stun.rixtelecom.se' },
  { urls: 'stun:stun.schlund.de' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.arbuz.ru:3478' },
  { urls: 'stun:stun.chathelp.ru:3478' },
  { urls: 'stun:stun.comtube.ru:3478' },
  { urls: 'stun:stun.kanet.ru:3478' },
  { urls: 'stun:stun.mgn.ru:3478' },
  { urls: 'stun:stun.ooonet.ru:3478' },
  { urls: 'stun:stun.sipnet.ru:3478' },
  { urls: 'stun:stun.skylink.ru:3478' },
  { urls: 'stun:stun.sovtest.ru:3478' },
  { urls: 'stun:stun.tis-dialog.ru:3478' },
  { urls: 'stun:stun.demos.ru:3478' },
  { urls: 'stun:stun.sipnet.net:3478' },
  { urls: 'stun:stunserver.org' },
  { urls: 'stun:stun.softjoys.com' },
  { urls: 'stun:stun.voiparound.com' },
  { urls: 'stun:stun.voipbuster.com' },
  { urls: 'stun:stun.voipstunt.com' },
  { urls: 'stun:stun.voxgratia.org' },
  { urls: 'stun:stun.xten.com' },
  {
    urls: 'turn:numb.viagenie.ca',
    credential: 'muazkh',
    username: 'webrtc@live.com',
  },
  {
    urls: 'turn:192.158.29.39:3478?transport=udp',
    credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
    username: '28224511:1379330808',
  },
  {
    urls: 'turn:192.158.29.39:3478?transport=tcp',
    credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
    username: '28224511:1379330808',
  },
  {
    urls: 'turn:turn.bistri.com:80',
    credential: 'homeo',
    username: 'homeo',
  },
  {
    urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
    credential: 'webrtc',
    username: 'webrtc',
  },
];

export const RECORDER_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=h264,aac',
  'video/mp4;codecs=h264',
  'video/mp4',
];

export const USE_NATIVE_SCREEN_RESOLUTION = true;

export const DEFAULT_STREAM_FRAME_RATE = 60;

export const generateRoomId = () => Math.random().toString(36).slice(2, 8).toUpperCase();
