export async function getVideoDevices() {
  await navigator.mediaDevices.getUserMedia({ video: true }); // request access to video
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((device) => device.kind === "videoinput");
  for (const device of videoDevices) {
    device.stream = await navigator.mediaDevices.getUserMedia({ video: device });
  }
  return videoDevices;
}
