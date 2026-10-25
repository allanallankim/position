export function cameraError(error, secure = true) {
  if (!secure) return '이 브라우저가 HTTP 카메라 접근을 차단했습니다. PC에서는 http://localhost:5173 으로 접속하거나 open-http-camera.ps1 -Url "현재 HTTP 주소"로 전용 브라우저를 실행해 주세요. 일반 브라우저와 휴대폰에서는 HTTPS가 필요합니다.';
  const messages = {
    NotAllowedError: '카메라 접근이 차단되었습니다. 주소창의 사이트 권한에서 카메라를 허용하고, Windows 설정 → 개인정보 및 보안 → 카메라에서 브라우저 접근을 확인해 주세요.',
    NotFoundError: '카메라를 찾을 수 없습니다. 장치 연결과 카메라 덮개를 확인해 주세요.',
    NotReadableError: '카메라를 열 수 없습니다. 화상회의 등 카메라를 사용하는 앱을 종료하고 Windows 카메라 권한을 확인해 주세요.',
    OverconstrainedError: '요청한 카메라 설정을 지원하지 않습니다. 다른 카메라를 연결하거나 브라우저를 다시 실행해 주세요.',
    SecurityError: '브라우저 보안 정책이 카메라를 차단했습니다. 미리보기 대신 localhost 주소를 브라우저 새 탭에서 열어 주세요.',
    AbortError: '카메라 연결이 중단되었습니다. 다시 시도해 주세요.'
  };
  return messages[error.name] || '카메라를 시작하지 못했습니다: ' + error.message;
}
export async function openCamera(mediaDevices) {
  try {
    return await mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
  } catch (error) {
    if (error.name !== 'OverconstrainedError') throw error;
    return mediaDevices.getUserMedia({video:true,audio:false});
  }
}
export function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
