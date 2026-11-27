import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';

function readRootFile(name: string): string {
  return readFileSync(resolve(cwd(), name), 'utf8');
}

describe('Cloud Run deployment and security configuration', () => {
  it('configures Dockerfile as multi-stage non-root container on port 8080', () => {
    const dockerfile = readRootFile('Dockerfile');
    expect(dockerfile).toContain('AS builder');
    expect(dockerfile).toContain('nginxinc/nginx-unprivileged:alpine');
    expect(dockerfile).toContain('ENV PORT=8080');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(dockerfile).toMatch(/^USER\s+nginx/m);
  });

  it('configures .dockerignore for clean build context', () => {
    const dockerignore = readRootFile('.dockerignore');
    for (const entry of ['node_modules', 'dist', '.git', '.superpowers', 'tests', 'coverage']) {
      expect(dockerignore).toContain(entry);
    }
  });

  it('configures nginx.conf with port 8080, /healthz, gzip, and self-hosted zero-egress CSP headers', () => {
    const nginx = readRootFile('nginx.conf');
    expect(nginx).toContain('listen 8080;');
    expect(nginx).toContain('location = /healthz');
    expect(nginx).toContain('return 200');
    expect(nginx).toContain('gzip on;');
    expect(nginx).toContain("connect-src 'self'");
    expect(nginx).toContain("worker-src 'self' blob:");
    expect(nginx).toContain("'wasm-unsafe-eval'");
    expect(nginx).toContain('X-Content-Type-Options "nosniff"');
    expect(nginx).toContain('X-Frame-Options "DENY"');
    expect(nginx).toContain('Referrer-Policy "no-referrer"');
  });

  it('includes cloudbuild.yaml, offline PDF font, README.md, and PROMPT_LOG.md deliverables', () => {
    const cloudbuild = readRootFile('cloudbuild.yaml');
    expect(cloudbuild).toContain('gcloud');
    expect(cloudbuild).toContain('run');
    expect(cloudbuild).toContain('--port=8080');

    expect(existsSync(resolve(cwd(), 'public/fonts/NotoSansTC-Regular.ttf'))).toBe(true);

    const readme = readRootFile('README.md');
    expect(readme.length).toBeGreaterThan(200);
    expect(readme).toContain("connect-src 'self'");

    const promptLog = readRootFile('PROMPT_LOG.md');
    expect(promptLog.length).toBeGreaterThan(200);
    expect(promptLog).toContain('Prompt Log');
  });
});
