interface LogFields {
  event: string;
  requestId?: string;
  route?: string;
  status?: number;
  userId?: string;
  roomId?: string;
  errorName?: string;
}

export function logSecurityEvent(level: 'info' | 'warn' | 'error', fields: LogFields): void {
  const record = JSON.stringify({ level, timestamp: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(record);
  else if (level === 'warn') console.warn(record);
  else console.info(record);
}
