import type { ConnectionStatus } from "../types";

interface Props {
  status: ConnectionStatus;
}

const config: Record<ConnectionStatus, { label: string; className: string }> = {
  connecting: {
    label: "Connecting",
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  },
  connected: {
    label: "Connected",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  disconnected: {
    label: "Disconnected",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  reconnecting: {
    label: "Reconnecting",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
};

export function ConnectionBadge({ status }: Props) {
  const { label, className } = config[status];

  return (
    <span
      role="status"
      className={`text-xs font-mono px-2 py-1 rounded border ${className}`}
    >
      {label}
    </span>
  );
}
