// empty = relative URLs: the Vite proxy in dev, same origin in production.
// A trailing slash is dropped so paths can be appended as "/events".
export const SERVER_URL: string = (
  import.meta.env.VITE_SERVER_URL ?? ""
).replace(/\/+$/, "");
