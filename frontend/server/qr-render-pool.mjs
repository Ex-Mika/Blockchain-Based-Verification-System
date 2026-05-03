/**
 * qr-render-pool.mjs — Worker-thread pool for parallel QR code rendering.
 */

import { cpus } from "node:os";
import { Worker } from "node:worker_threads";

import { createHttpError } from "./http-utils.mjs";

/**
 * Create a fixed-size worker pool that renders QR codes in parallel.
 *
 * @param {object}  options
 * @param {number}  options.concurrency   Number of worker threads.
 * @param {object}  options.renderOptions QR render options forwarded to each worker.
 * @param {URL}     options.workerUrl     URL of the worker module.
 */
export function createQrRenderPool({
  concurrency,
  renderOptions,
  workerUrl
}) {
  const queue = [];
  const workers = [];
  let nextTaskId = 1;

  for (let index = 0; index < concurrency; index += 1) {
    workers.push(spawnWorkerState(index));
  }

  return {
    concurrency,
    render(payload) {
      return new Promise((resolve, reject) => {
        queue.push({
          id: nextTaskId,
          payload,
          reject,
          resolve
        });
        nextTaskId += 1;
        dispatch();
      });
    }
  };

  function spawnWorkerState(workerIndex) {
    const state = {
      busy: false,
      currentTask: null,
      index: workerIndex,
      worker: null
    };

    attachWorker(state);
    return state;
  }

  function attachWorker(state) {
    const worker = new Worker(workerUrl, { type: "module" });
    state.worker = worker;

    worker.on("message", (message) => {
      const currentTask = state.currentTask;
      state.busy = false;
      state.currentTask = null;

      if (!currentTask || message?.taskId !== currentTask.id) {
        dispatch();
        return;
      }

      if (message?.error) {
        currentTask.reject(createHttpError(400, message.error));
      } else {
        currentTask.resolve(
          Buffer.from(
            message.fileBytes.buffer,
            message.fileBytes.byteOffset,
            message.fileBytes.byteLength
          )
        );
      }

      dispatch();
    });

    worker.on("error", (error) => {
      const currentTask = state.currentTask;
      state.busy = false;
      state.currentTask = null;

      if (currentTask) {
        currentTask.reject(error);
      }
    });

    worker.on("exit", (code) => {
      const currentTask = state.currentTask;
      state.busy = false;
      state.currentTask = null;

      if (currentTask) {
        currentTask.reject(
          createHttpError(500, `QR renderer worker ${state.index + 1} stopped unexpectedly.`)
        );
      }

      if (code !== 0) {
        attachWorker(state);
      }

      dispatch();
    });
  }

  function dispatch() {
    for (const state of workers) {
      if (state.busy || !queue.length) {
        continue;
      }

      const task = queue.shift();
      state.busy = true;
      state.currentTask = task;
      state.worker.postMessage({
        payload: task.payload,
        renderOptions,
        taskId: task.id
      });
    }
  }
}

/**
 * Resolve the image width for archive QR codes, falling back to 640.
 */
export function resolveQrArchiveImageWidth(configuredWidth) {
  const parsedWidth = Number(configuredWidth);
  if (!Number.isFinite(parsedWidth) || parsedWidth < 256) {
    return 640;
  }

  return Math.round(parsedWidth);
}

/**
 * Resolve worker concurrency from config, defaulting to CPU count capped at 6.
 */
export function resolveQrRenderConcurrency(configuredConcurrency) {
  const parsedConcurrency = Number(configuredConcurrency);
  if (Number.isFinite(parsedConcurrency) && parsedConcurrency > 0) {
    return Math.max(1, Math.round(parsedConcurrency));
  }

  const cpuCount = cpus().length || 1;
  return Math.max(1, Math.min(cpuCount, 6));
}

/**
 * Compute the per-iteration batch size for QR rendering.
 */
export function resolveQrRenderBatchSize(credentialCount, poolConcurrency) {
  return Math.max(1, Math.min(credentialCount, poolConcurrency));
}

/**
 * Shallow-clone render options so the QR library cannot mutate the originals.
 */
export function cloneQrRenderOptions(renderOptions) {
  return {
    ...renderOptions,
    color: renderOptions.color ? { ...renderOptions.color } : undefined,
    rendererOpts: renderOptions.rendererOpts ? { ...renderOptions.rendererOpts } : undefined
  };
}
