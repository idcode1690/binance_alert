// Deprecated: Worker removed in favor of Cloudflare Pages Functions (`/functions`).
const removedWorker = {
  fetch() {
    return new Response('Worker removed. Use Cloudflare Pages Functions.', { status: 410 });
  }
};
export default removedWorker;

