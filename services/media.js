export async function getUserMedia() {
  await navigator.mediaDevices.getUserMedia({ video: true }); // request access to video
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((device) => device.kind === "videoinput");
  const resolutions = [
    { width: {exact: 3840}, height: {exact: 2160 } },
    { width: {exact: 1920}, height: {exact: 1080 } },
    { width: {exact: 1600}, height: {exact: 1200 } },
    { width: {exact: 1280}, height: {exact: 720 } },
    { width: {exact: 800}, height: {exact: 600 } },
    { width: {exact: 640}, height: {exact: 480 } },
    {}
  ];
  for (const device of videoDevices) {
    // assign highest-resolution stream to each device
    for (const resolution of resolutions) {
      try {
        const constraints = {
          video: {
            deviceId: device.deviceId,
            ...resolution
          }
        };
        device.stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (e) {
        console.log("error getting stream", e);
      }
    }
  }
  return videoDevices;
}

export async function getDisplayMedia() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  return { stream, label: "Window" };
}
