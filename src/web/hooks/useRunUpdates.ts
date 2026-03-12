import { useCallback, useEffect, useRef } from 'react';
import { useRunStore } from '../stores/runStore';
import type { Agent, Escalation, LogEntry, Story } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || '';
const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

interface WebSocketMessage {
  type: string;
  runId: string;
  data: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  status?: string;
  timestamp?: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export function useRunUpdates(runId: string | null) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<ConnectionStatus>('disconnected');
  const isMounted = useRef(true);

  const { updateStory, updateAgent, addLog, addEscalation, setActiveRun } = useRunStore();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      let message: WebSocketMessage;
      try {
        message = JSON.parse(event.data as string) as WebSocketMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'story_update':
          updateStory(message.data as unknown as Story);
          break;
        case 'agent_update':
          updateAgent(message.data as unknown as Agent);
          break;
        case 'log_entry':
          addLog(message.data as unknown as LogEntry);
          break;
        case 'escalation':
          addEscalation(message.data as unknown as Escalation);
          break;
        case 'pr_created':
          updateStory(message.data as unknown as Story);
          break;
        case 'run_complete':
          setActiveRun({
            ...useRunStore.getState().activeRun!,
            status: 'completed',
            completedAt: message.timestamp || new Date().toISOString(),
          });
          break;
      }
    },
    [updateStory, updateAgent, addLog, addEscalation, setActiveRun]
  );

  const connect = useCallback(() => {
    if (!runId || !isMounted.current || !WS_URL) return;

    statusRef.current = reconnectAttempt.current > 0 ? 'reconnecting' : 'connecting';

    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      statusRef.current = 'connected';
      reconnectAttempt.current = 0;
      socket.send(JSON.stringify({ action: 'subscribe', runId }));
    };

    socket.onmessage = handleMessage;

    socket.onclose = () => {
      statusRef.current = 'disconnected';
      if (isMounted.current && runId) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    };

    ws.current = socket;
  }, [runId, handleMessage]);

  const scheduleReconnect = useCallback(() => {
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempt.current),
      MAX_RECONNECT_DELAY
    );
    reconnectAttempt.current++;
    reconnectTimer.current = setTimeout(() => {
      if (isMounted.current) {
        connect();
      }
    }, delay);
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (ws.current) {
      ws.current.onclose = null; // prevent reconnect on intentional close
      ws.current.close();
      ws.current = null;
    }
    reconnectAttempt.current = 0;
    statusRef.current = 'disconnected';
  }, []);

  useEffect(() => {
    isMounted.current = true;
    if (runId) {
      connect();
    }
    return () => {
      isMounted.current = false;
      disconnect();
    };
  }, [runId, connect, disconnect]);

  return { status: statusRef, disconnect };
}
