/** 10 GiB in bytes — enforced in the service as UPLOAD_TOO_LARGE */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

export const VIDEO_QUEUE = 'video';
export const VIDEO_PROCESSING_JOB = 'video.processing';

/** The worker only marks a video `failed` after the last attempt fails */
export const VIDEO_PROCESSING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
} as const;
