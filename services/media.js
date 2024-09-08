export async function getUserMedia() {
  await navigator.mediaDevices.getUserMedia({ video: true }); // request access to video
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((device) => device.kind === "videoinput");
  for (const device of videoDevices) {
    // assign stream to each device
    device.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: device.deviceId } });
  }
  return videoDevices;
}

export async function getDisplayMedia() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  return { stream, label: "Window" };
}
