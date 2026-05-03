import { parentPort } from "node:worker_threads";
import QRCode from "qrcode";

if (!parentPort) {
  throw new Error("QR render worker requires a parent port.");
}

const svgEncoder = new TextEncoder();

parentPort.on("message", async (message) => {
  try {
    const svgMarkup = await QRCode.toString(
      message.payload,
      cloneQrRenderOptions(message.renderOptions)
    );
    const fileBytes = svgEncoder.encode(svgMarkup);

    parentPort.postMessage({
      fileBytes,
      taskId: message.taskId
    }, [fileBytes.buffer]);
  } catch {
    parentPort.postMessage({
      error: "The verification payload is too large for a scannable QR code.",
      taskId: message.taskId
    });
  }
});

function cloneQrRenderOptions(renderOptions) {
  return {
    ...renderOptions,
    color: renderOptions.color ? { ...renderOptions.color } : undefined,
    rendererOpts: renderOptions.rendererOpts ? { ...renderOptions.rendererOpts } : undefined
  };
}
