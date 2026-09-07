import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useRpc, useRpcResponse } from '../hooks/use-rpc-request.hook';
import {
  onyvoreRpcMethods,
  type NotebookGraph,
  type GraphEdge,
} from '@onivoro/isomorphic-onyvore';
import type { RootState } from '../state/types/root-state.type';

interface Body {
  path: string;
  title: string;
  degree: number;
  orphan: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/** Deterministic placement so a reload does not reshuffle the whole graph. */
function seedPosition(index: number, total: number, radius: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = index * golden;
  const distance = radius * Math.sqrt((index + 0.5) / Math.max(1, total));
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export function GraphPanel() {
  const { sendRequest } = useRpc();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodiesRef = useRef<Body[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const frameRef = useRef<number>(0);
  const hoverRef = useRef<Body | null>(null);
  const viewRef = useRef({ scale: 1, x: 0, y: 0 });

  const [graph, setGraph] = useState<NotebookGraph | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const response = useRpcResponse(requestId);

  const notebookId = useSelector(
    (state: RootState) => state.activeNotebook.notebookId,
  );
  const activeNotePath = useSelector(
    (state: RootState) => state.activeNotebook.activeNotePath,
  );
  const indexVersion = useSelector(
    (state: RootState) => state.notebooks.indexVersion,
  );

  useEffect(() => {
    if (!notebookId) {
      setGraph(null);
      return;
    }
    setRequestId(
      sendRequest({
        method: onyvoreRpcMethods.NOTEBOOK_GET_GRAPH,
        params: { notebookId },
      }),
    );
  }, [notebookId, indexVersion]);

  useEffect(() => {
    if (response?.result) setGraph(response.result as NotebookGraph);
  }, [response]);

  // Build the simulation whenever the graph changes.
  useEffect(() => {
    if (!graph) {
      bodiesRef.current = [];
      edgesRef.current = [];
      return;
    }

    const count = graph.nodes.length;
    bodiesRef.current = graph.nodes.map((node, i) => {
      const { x, y } = seedPosition(i, count, 160);
      return {
        path: node.relativePath,
        title: node.title,
        degree: node.degree,
        orphan: node.orphan,
        x,
        y,
        vx: 0,
        vy: 0,
        radius: 3 + Math.min(7, Math.sqrt(node.degree) * 2),
      };
    });
    edgesRef.current = graph.edges;
  }, [graph]);

  // Force simulation + rendering.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let alpha = 1;
    let running = true;

    const colors = {
      explicit: themeColor('--vscode-charts-blue', '#4589d6'),
      mention: themeColor('--vscode-charts-green', '#57a64a'),
      similar: themeColor('--vscode-panel-border', '#80808055'),
      node: themeColor('--vscode-editor-foreground', '#cccccc'),
      active: themeColor('--vscode-charts-orange', '#d18616'),
      orphan: themeColor('--vscode-descriptionForeground', '#8c8c8c'),
      text: themeColor('--vscode-editor-foreground', '#cccccc'),
    };

    const byPath = new Map<string, Body>();

    const step = () => {
      if (!running) return;

      const bodies = bodiesRef.current;
      const edges = edgesRef.current;

      byPath.clear();
      for (const body of bodies) byPath.set(body.path, body);

      if (alpha > 0.005) {
        // Repulsion. Node counts are capped server-side, so the naive O(n²)
        // pass stays well inside a frame budget.
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i];
            const b = bodies[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let distSq = dx * dx + dy * dy;
            if (distSq < 0.01) {
              dx = (i - j) * 0.1 || 0.1;
              dy = 0.1;
              distSq = dx * dx + dy * dy;
            }
            const force = 600 / distSq;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
          }
        }

        // Springs. Authored links pull harder than computed ones, so the
        // layout reflects how much each edge type is worth trusting.
        for (const edge of edges) {
          const a = byPath.get(edge.source);
          const b = byPath.get(edge.target);
          if (!a || !b) continue;

          const strength =
            edge.type === 'explicit' ? 0.02 : edge.type === 'mention' ? 0.012 : 0.004;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const displacement = (dist - 60) * strength;
          const fx = (dx / dist) * displacement;
          const fy = (dy / dist) * displacement;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }

        for (const body of bodies) {
          body.vx -= body.x * 0.002; // gravity toward the center
          body.vy -= body.y * 0.002;
          body.x += body.vx * alpha;
          body.y += body.vy * alpha;
          body.vx *= 0.82;
          body.vy *= 0.82;
        }

        alpha *= 0.985;
      }

      // ---- render ----
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2 + viewRef.current.x, height / 2 + viewRef.current.y);
      ctx.scale(viewRef.current.scale, viewRef.current.scale);

      for (const edge of edges) {
        const a = byPath.get(edge.source);
        const b = byPath.get(edge.target);
        if (!a || !b) continue;

        ctx.strokeStyle = colors[edge.type] ?? colors.similar;
        ctx.globalAlpha = edge.type === 'similar' ? 0.25 : 0.6;
        ctx.lineWidth = edge.type === 'explicit' ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const body of bodies) {
        const isActive = body.path === activeNotePath;
        ctx.fillStyle = isActive
          ? colors.active
          : body.orphan
            ? colors.orphan
            : colors.node;
        ctx.beginPath();
        ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
        ctx.fill();

        if (isActive) {
          ctx.strokeStyle = colors.active;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(body.x, body.y, body.radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Label only what the reader can actually read: the active note, the
      // hovered node, and the best-connected few.
      const labelled = new Set<Body>();
      if (hoverRef.current) labelled.add(hoverRef.current);
      for (const body of bodies) {
        if (body.path === activeNotePath) labelled.add(body);
      }
      for (const body of [...bodies].sort((a, b) => b.degree - a.degree).slice(0, 8)) {
        labelled.add(body);
      }

      ctx.fillStyle = colors.text;
      ctx.font = '10px var(--vscode-font-family, sans-serif)';
      ctx.textAlign = 'center';
      for (const body of labelled) {
        ctx.fillText(body.title, body.x, body.y - body.radius - 4);
      }

      ctx.restore();
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [graph, activeNotePath]);

  const bodyAt = (event: React.MouseEvent): Body | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { scale, x: panX, y: panY } = viewRef.current;
    const x = (event.clientX - rect.left - rect.width / 2 - panX) / scale;
    const y = (event.clientY - rect.top - rect.height / 2 - panY) / scale;

    return (
      bodiesRef.current.find((body) => {
        const dx = body.x - x;
        const dy = body.y - y;
        return dx * dx + dy * dy <= (body.radius + 4) ** 2;
      }) ?? null
    );
  };

  if (!notebookId) {
    return <div className="ony-empty__hint">Open a note to see its notebook graph.</div>;
  }

  if (!graph) {
    return <div className="ony-empty__hint">Loading graph...</div>;
  }

  if (graph.nodes.length === 0) {
    return <div className="ony-empty__hint">This notebook has no notes yet.</div>;
  }

  return (
    <div className="ony-graph">
      <canvas
        ref={canvasRef}
        className="ony-graph__canvas"
        onMouseMove={(e) => {
          const body = bodyAt(e);
          hoverRef.current = body;
          if (canvasRef.current) {
            canvasRef.current.style.cursor = body ? 'pointer' : 'default';
          }
        }}
        onMouseLeave={() => {
          hoverRef.current = null;
        }}
        onClick={(e) => {
          const body = bodyAt(e);
          if (!body) return;
          sendRequest({
            method: onyvoreRpcMethods.OPEN_FILE,
            params: { notebookId, relativePath: body.path },
          });
        }}
        onWheel={(e) => {
          const next = viewRef.current.scale * (e.deltaY < 0 ? 1.1 : 0.9);
          viewRef.current.scale = Math.min(4, Math.max(0.2, next));
        }}
      />
      <div className="ony-graph__legend">
        <span className="ony-graph__key ony-graph__key--explicit">Links</span>
        <span className="ony-graph__key ony-graph__key--mention">Mentions</span>
        <span className="ony-graph__key ony-graph__key--similar">Related</span>
        {graph.truncated > 0 && (
          <span className="ony-graph__truncated">
            showing {graph.nodes.length} best-connected of{' '}
            {graph.nodes.length + graph.truncated}
          </span>
        )}
      </div>
    </div>
  );
}
