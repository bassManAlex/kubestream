// empty = relative URLs: the Vite proxy in dev, same origin in production
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "";
