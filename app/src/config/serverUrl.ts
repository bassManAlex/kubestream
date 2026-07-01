// "" keeps requests relative so the Vite proxy (and any same-origin
// deployment) applies; override with VITE_SERVER_URL when the API is on
// another origin (e.g. a static build served separately from the backend).
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "";
