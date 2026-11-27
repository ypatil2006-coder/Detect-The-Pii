import { useEffect, useMemo, useRef, useState } from 'react';
import type { PipelineStageTiming } from '../core/pipeline';

export interface PipelineFlowProps {
  stages: PipelineStageTiming[];
  totalMs: number;
  isRunning: boolean;
  runId: number;
}

const TOTAL_FRAMES = 105;
const STEP_FRAMES = [18, 38, 68, 86, 105] as const;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function cubicBezierY(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  let u = clamped;
  for (let i = 0; i < 6; i += 1) {
    const inv = 1 - u;
    const x = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
    const dx =
      3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-5) break;
    u = Math.min(1, Math.max(0, u - (x - clamped) / dx));
  }
  const inv = 1 - u;
  return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
}

function interpolate(
  frame: number,
  inputRange: readonly [number, number],
  outputRange: readonly [number, number],
  easing?: (t: number) => number,
): number {
  const [inStart, inEnd] = inputRange;
  const [outStart, outEnd] = outputRange;
  if (inEnd === inStart) return outEnd;
  const raw = Math.min(1, Math.max(0, (frame - inStart) / (inEnd - inStart)));
  const eased = easing ? easing(raw) : raw;
  return outStart + (outEnd - outStart) * eased;
}

const arriveEase = (t: number) => cubicBezierY(t, 0.16, 1, 0.3, 1);

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '< 0.1 ms';
  if (ms < 0.1) return '< 0.1 ms';
  return `${ms.toFixed(1)} ms`;
}

function findStage(
  stages: PipelineStageTiming[],
  id: PipelineStageTiming['id'],
): PipelineStageTiming | undefined {
  return stages.find((s) => s.id === id);
}

interface NodeCardProps {
  role: string;
  roleClass: string;
  icon: string;
  title: string;
  subtitle: string;
  stage?: PipelineStageTiming;
  progress: number;
  active: boolean;
  done: boolean;
  branch?: boolean;
}

function PipelineNodeCard({
  role,
  roleClass,
  icon,
  title,
  subtitle,
  stage,
  progress,
  active,
  done,
  branch = false,
}: NodeCardProps) {
  const reduced = prefersReducedMotion();
  const opacity = reduced ? 1 : 0.45 + 0.55 * progress;
  const scale = reduced ? 1 : 0.96 + 0.04 * progress;
  const matched = stage?.matchedCount ?? 0;
  const rejected = stage?.rejectedCount ?? 0;
  const statusLabel = done ? 'MATCHED' : active ? 'RUNNING' : 'IDLE';

  return (
    <div
      className={`pipeline-node-slot ${branch ? 'pipeline-node-slot--branch' : ''}`}
      style={{
        opacity,
        transform: `scale(${scale.toFixed(4)})`,
      }}
    >
      <span className={`pipeline-role-tag ${roleClass}`}>{role}</span>
      <div className={`pipeline-node ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`}>
        <div className="pipeline-node__head">
          <div className="pipeline-node__title-wrap">
            <span className="pipeline-node__icon" aria-hidden="true">
              {icon}
            </span>
            <div>
              <div className="pipeline-node__title">{title}</div>
              <div className="pipeline-node__sub">{subtitle}</div>
            </div>
          </div>
          <span className="pipeline-node__metric">{formatMs(stage?.durationMs ?? 0)}</span>
        </div>

        <div className="pipeline-node__meta">
          <span
            className={`pipeline-badge ${
              done ? 'pipeline-badge--ok' : active ? 'pipeline-badge--run' : ''
            }`}
          >
            {statusLabel}
          </span>
          <span className="pipeline-badge">{matched} MATCHED</span>
          {typeof stage?.rejectedCount === 'number' && (
            <span className={`pipeline-badge ${rejected > 0 ? 'pipeline-badge--warn' : ''}`}>
              {rejected} REJECTED
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Connected rapid-check workflow canvas modeled on Image 1, with deterministic
 * frame-based Play / Pause / Step / Replay scrubber controls and sub-ms badges.
 */
export function PipelineFlow({ stages, totalMs, isRunning, runId }: PipelineFlowProps) {
  const [frame, setFrame] = useState<number>(() =>
    prefersReducedMotion() || (stages.length > 0 && !isRunning) ? TOTAL_FRAMES : 0,
  );
  const [playing, setPlaying] = useState<boolean>(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (runId === 0 && stages.length === 0) {
      return;
    }
    if (prefersReducedMotion()) {
      setPlaying(false);
      setFrame(TOTAL_FRAMES);
      return;
    }
    setFrame(0);
    setPlaying(true);
  }, [runId, stages.length]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
      return;
    }

    const tick = (ts: number) => {
      if (lastTsRef.current === null) {
        lastTsRef.current = ts;
      }
      const deltaMs = ts - lastTsRef.current;
      lastTsRef.current = ts;
      const frameAdvance = (deltaMs / 1000) * 60;

      setFrame((prev) => {
        const next = Math.min(TOTAL_FRAMES, prev + frameAdvance);
        if (next >= TOTAL_FRAMES) {
          setPlaying(false);
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing]);

  const phaseProgress = useMemo(
    () => ({
      parse: interpolate(frame, [0, 18], [0, 1], arriveEase),
      scan: interpolate(frame, [16, 38], [0, 1], arriveEase),
      luhn: interpolate(frame, [34, 62], [0, 1], arriveEase),
      verhoeff: interpolate(frame, [38, 65], [0, 1], arriveEase),
      validators: interpolate(frame, [42, 68], [0, 1], arriveEase),
      redact: interpolate(frame, [64, 86], [0, 1], arriveEase),
      diff: interpolate(frame, [82, 105], [0, 1], arriveEase),
    }),
    [frame],
  );

  const stageParse = findStage(stages, 'parse');
  const stageScan = findStage(stages, 'scan');
  const stageLuhn = findStage(stages, 'luhn');
  const stageVerhoeff = findStage(stages, 'verhoeff');
  const stageValidators = findStage(stages, 'validators');
  const stageRedact = findStage(stages, 'redact');
  const stageDiff = findStage(stages, 'diff');

  const completed = frame >= TOTAL_FRAMES && !isRunning;
  const currentPhase = STEP_FRAMES.findIndex((f) => frame < f);
  const displayPhase = currentPhase === -1 ? STEP_FRAMES.length : currentPhase + 1;

  const handleTogglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (frame >= TOTAL_FRAMES) {
      setFrame(0);
    }
    setPlaying(true);
  };

  const handleStep = () => {
    setPlaying(false);
    const nextTarget = STEP_FRAMES.find((f) => f > frame + 0.5) ?? TOTAL_FRAMES;
    setFrame(nextTarget);
  };

  const handleReplay = () => {
    setFrame(0);
    setPlaying(!prefersReducedMotion());
    if (prefersReducedMotion()) {
      setFrame(TOTAL_FRAMES);
    }
  };

  return (
    <section className="pipeline-flow" aria-label="Sanitization pipeline workflow">
      <div className="pipeline-flow__header">
        <div className="pipeline-flow__title-group">
          <span className="pipeline-flow__crumb">Workflow / Rapid Local PII Pipeline</span>
          <span
            className={`pipeline-flow__status-pill ${
              completed ? 'is-done' : playing || isRunning ? 'is-active' : ''
            }`}
          >
            {completed ? 'Verified' : playing || isRunning ? 'Running' : 'Ready'}
          </span>
        </div>
        <span className="pipeline-flow__total-ms">Total {formatMs(totalMs)}</span>
      </div>

      <div className="pipeline-canvas">
        <PipelineNodeCard
          role="Input Parser"
          roleClass="pipeline-role-tag--parser"
          icon="IN"
          title="Input Parse"
          subtitle="Normalize UTF-16 & format layout"
          stage={stageParse}
          progress={phaseProgress.parse}
          active={frame > 0 && frame < 18}
          done={frame >= 18}
        />

        <svg
          className="pipeline-connector-svg"
          viewBox="0 0 720 30"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M 360 0 L 360 30"
            className={`pipeline-connector-path ${
              frame >= 18 ? 'is-done' : frame > 8 ? 'is-active' : ''
            }`}
          />
          {!prefersReducedMotion() && frame > 8 && frame < 18 && (
            <circle
              cx={360}
              cy={interpolate(frame, [8, 18], [2, 28], arriveEase)}
              r={3.5}
              className="pipeline-pulse-dot"
            />
          )}
        </svg>

        <PipelineNodeCard
          role="Pattern Engine"
          roleClass="pipeline-role-tag--scanner"
          icon="RE"
          title="Pattern Scan"
          subtitle="Linear-time candidate extraction"
          stage={stageScan}
          progress={phaseProgress.scan}
          active={frame >= 16 && frame < 38}
          done={frame >= 38}
        />

        <svg
          className="pipeline-connector-svg pipeline-connector-svg--tall"
          viewBox="0 0 720 44"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M 360 0 L 360 18 L 116 18 Q 104 18 104 30 L 104 44"
            className={`pipeline-connector-path ${
              frame >= 62 ? 'is-done' : frame >= 34 ? 'is-active' : ''
            }`}
          />
          <path
            d="M 360 0 L 360 44"
            className={`pipeline-connector-path ${
              frame >= 65 ? 'is-done' : frame >= 38 ? 'is-active' : ''
            }`}
          />
          <path
            d="M 360 0 L 360 18 L 604 18 Q 616 18 616 30 L 616 44"
            className={`pipeline-connector-path ${
              frame >= 68 ? 'is-done' : frame >= 42 ? 'is-active' : ''
            }`}
          />
        </svg>

        <div className="pipeline-branch-labels" aria-hidden="true">
          <span className="pipeline-condition-pill">Condition 1 · Card</span>
          <span className="pipeline-condition-pill">Condition 2 · Aadhaar</span>
          <span className="pipeline-condition-pill">Condition 3 · Formats</span>
        </div>

        <div className="pipeline-branch-row">
          <PipelineNodeCard
            branch
            role="Validator Branch"
            roleClass="pipeline-role-tag--branch-luhn"
            icon="CC"
            title="Luhn Card Check"
            subtitle="Mod-10 + issuer prefix"
            stage={stageLuhn}
            progress={phaseProgress.luhn}
            active={frame >= 34 && frame < 62}
            done={frame >= 62}
          />
          <PipelineNodeCard
            branch
            role="Validator Branch"
            roleClass="pipeline-role-tag--branch-verhoeff"
            icon="ID"
            title="Verhoeff Aadhaar Check"
            subtitle="12-digit checksum table"
            stage={stageVerhoeff}
            progress={phaseProgress.verhoeff}
            active={frame >= 38 && frame < 65}
            done={frame >= 65}
          />
          <PipelineNodeCard
            branch
            role="Validator Branch"
            roleClass="pipeline-role-tag--branch-intl"
            icon="FX"
            title="PAN / IP / Email / Phone"
            subtitle="Entity code, octet & libphonenumber"
            stage={stageValidators}
            progress={phaseProgress.validators}
            active={frame >= 42 && frame < 68}
            done={frame >= 68}
          />
        </div>

        <svg
          className="pipeline-connector-svg pipeline-connector-svg--tall"
          viewBox="0 0 720 44"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M 104 0 L 104 16 Q 104 28 116 28 L 360 28 L 360 44"
            className={`pipeline-connector-path ${
              frame >= 86 ? 'is-done' : frame >= 64 ? 'is-active' : ''
            }`}
          />
          <path
            d="M 360 0 L 360 44"
            className={`pipeline-connector-path ${
              frame >= 86 ? 'is-done' : frame >= 64 ? 'is-active' : ''
            }`}
          />
          <path
            d="M 616 0 L 616 16 Q 616 28 604 28 L 360 28 L 360 44"
            className={`pipeline-connector-path ${
              frame >= 86 ? 'is-done' : frame >= 64 ? 'is-active' : ''
            }`}
          />
        </svg>

        <PipelineNodeCard
          role="Mode Operator"
          roleClass="pipeline-role-tag--operator"
          icon="OP"
          title="Mode Operator"
          subtitle="Apply mask, pseudonym or retention"
          stage={stageRedact}
          progress={phaseProgress.redact}
          active={frame >= 64 && frame < 86}
          done={frame >= 86}
        />

        <svg
          className="pipeline-connector-svg"
          viewBox="0 0 720 30"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M 360 0 L 360 30"
            className={`pipeline-connector-path ${
              frame >= 105 ? 'is-done' : frame >= 82 ? 'is-active' : ''
            }`}
          />
          {!prefersReducedMotion() && frame >= 82 && frame < 105 && (
            <circle
              cx={360}
              cy={interpolate(frame, [82, 105], [2, 28], arriveEase)}
              r={3.5}
              className="pipeline-pulse-dot"
            />
          )}
        </svg>

        <PipelineNodeCard
          role="System Output"
          roleClass="pipeline-role-tag--operator"
          icon="DF"
          title="Diff & Export"
          subtitle="Synchronized side-by-side & local Blob"
          stage={stageDiff}
          progress={phaseProgress.diff}
          active={frame >= 82 && frame < 105}
          done={frame >= 105}
        />
      </div>

      <div className="pipeline-transport" role="group" aria-label="Pipeline timeline controls">
        <div className="pipeline-transport__actions">
          <button
            type="button"
            className="ui-btn ui-btn--primary ui-btn--sm"
            onClick={handleTogglePlay}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="ui-btn ui-btn--sm" onClick={handleStep}>
            Step
          </button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={handleReplay}>
            Replay
          </button>
        </div>
        <div className="pipeline-transport__scrubber-wrap">
          <input
            type="range"
            min={0}
            max={TOTAL_FRAMES}
            step={1}
            value={Math.round(frame)}
            aria-label="Timeline scrubber"
            className="pipeline-scrubber"
            onChange={(e) => {
              setPlaying(false);
              setFrame(Number(e.target.value));
            }}
          />
          <span className="pipeline-transport__readout">
            Phase {displayPhase}/{STEP_FRAMES.length} · {Math.round((frame / TOTAL_FRAMES) * 100)}%
          </span>
        </div>
      </div>
    </section>
  );
}
