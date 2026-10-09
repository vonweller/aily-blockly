const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const vm = require('node:vm');
const { test } = require('node:test');
const yaml = require('js-yaml');
const { releaseFiles } = require('./coder-release-manifest.cjs');

const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/coder.yml'), 'utf8'));
const step = (job, name) => workflow.jobs[job].steps.find(step => step.name === name);
const environment = {
  GITHUB_REPOSITORY: 'source/repo', GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40),
  GITHUB_OUTPUT: 'output', CODER_RELEASE_REPOSITORY: 'target/repo',
  RELEASE_TAG: 'v0.1.7', RELEASE_VERSION: '0.1.7', RELEASE_CHANNEL: 'stable',
};
const marker = `<!-- coder-run:source/repo:123:${environment.GITHUB_SHA} -->`;
function run(job, name, modules, env = {}) {
  const source = step(job, name).run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)[1];
  return vm.runInNewContext(source, {
    Buffer, process: { env: { ...environment, ...env } },
    require(name) {
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name === 'semver' || name === 'node:crypto') return require(name);
      if (name === './scripts/coder-release-manifest.cjs') return { releaseFiles };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
}

function guard(releases = [], tags = []) {
  const written = {};
  run('publish-release', 'Reject reused tags or older channel versions', {
    './releases.json': [releases], './tags.json': tags,
    'node:fs': {
      readFileSync: () => 'Archived changelog',
      writeFileSync: (name, value) => { written[name] = value; },
      appendFileSync: (name, value) => { written[name] = value; },
    },
  });
  return written;
}

test('new releases and same-run drafts can publish; same-run published releases only verify', () => {
  assert.match(guard().output, /published=false/);
  const own = { id: 7, tag_name: 'v0.1.7', body: marker, draft: true, prerelease: false };
  const tags = [{ ref: 'refs/tags/v0.1.7' }];
  const recovered = guard([own], tags);
  assert.match(recovered.output, /published=false\nrelease_id=7/);
  assert.equal(recovered['release-body.md'], `Archived changelog\n\n${marker}\n`);
  assert.match(guard([{ ...own, draft: false }], tags).output, /published=true\nrelease_id=7/);
  assert.equal(step('publish-release', 'Upload all four packages and product manifests to a draft').if,
    "steps.release.outputs.published != 'true'");
});

test('foreign releases, orphan tags, and newer published versions cannot be overwritten', () => {
  const tags = [{ ref: 'refs/tags/v0.1.7' }];
  assert.throws(() => guard([], tags), /another run/);
  for (const draft of [true, false]) {
    assert.throws(() => guard([{ tag_name: 'v0.1.7', body: marker.replace(':123:', ':124:'), draft }], tags), /another run/);
  }
  assert.throws(() => guard([{ tag_name: 'v0.1.8', draft: false, prerelease: false }]), /newer than published/);
});

async function finishRelease({ published = false, channel = 'stable', alter = () => {} } = {}) {
  const files = new Map(['CHANGELOG_CODER.md', 'CHANGELOG_CODER_ZH.md'].map(name => [name, Buffer.from(name)]));
  for (const platform of ['windows', 'macos']) for (const flavor of ['cn', 'global']) {
    const { manifest, packages } = releaseFiles(platform, flavor, environment.RELEASE_VERSION);
    for (const name of [manifest, ...packages]) files.set(name, Buffer.from(name));
  }
  const assets = [...files].map(([name, content]) => ({ name, size: content.length, state: 'uploaded',
    digest: `sha256:${crypto.createHash('sha256').update(content).digest('hex')}` }));
  alter(assets);
  const updates = [];
  await run('publish-release', 'Verify complete Release assets before publication', {
    'node:fs': {
      createReadStream: name => Readable.from(files.get(name.replace(/^release\//, ''))),
      statSync: name => ({ size: files.get(name.replace(/^release\//, '')).length }),
    },
    'node:child_process': { execFileSync(command, args, options) {
      assert.equal(command, 'gh');
      if (args.includes('PATCH')) updates.push(JSON.parse(options.input));
      else {
        assert.ok(args.includes('repos/target/repo/releases/7/assets?per_page=100'));
        return JSON.stringify([assets]);
      }
    } },
  }, { RELEASE_ID: '7', ALREADY_PUBLISHED: String(published), RELEASE_CHANNEL: channel, MAKE_LATEST: String(channel === 'stable') });
  return updates;
}

test('publish only complete matching assets; a lost publication response needs no external mutation', async () => {
  assert.deepEqual(await finishRelease(), [{ draft: false, prerelease: false, make_latest: 'true' }]);
  assert.deepEqual(await finishRelease({ channel: 'beta' }), [{ draft: false, prerelease: true, make_latest: 'false' }]);
  assert.deepEqual(await finishRelease({ published: true }), []);
  for (const alter of [assets => assets.pop(), assets => { assets[0].digest = 'sha256:wrong'; },
    assets => { assets[0].state = 'starter'; }]) {
    await assert.rejects(finishRelease({ alter }), /Release asset/);
    await assert.rejects(finishRelease({ published: true, alter }), /Release asset/);
  }
});

function saveBaseline({ previous = 'b'.repeat(40), relation = 'ahead', conflict = false, next = previous } = {}) {
  const updates = [];
  let reads = 0;
  run('save-source-baseline', "Save only this Coder channel's source SHA", {
    'node:child_process': {
      spawnSync(command, args) {
        assert.equal(command, 'gh');
        if (args[1].endsWith('/git/ref/heads/release-meta')) return { status: 0 };
        assert.equal(args[1], 'repos/source/repo/contents/last-sha-coder-stable?ref=release-meta');
        const source = reads++ === 0 ? previous : next;
        return source === null ? { status: 1, stderr: 'HTTP 404' } : { status: 0,
          stdout: JSON.stringify({ sha: `blob-${reads}`, content: Buffer.from(source).toString('base64') }) };
      },
      execFileSync(command, args, options) {
        assert.equal(command, 'gh');
        if (args.includes('--jq')) {
          assert.ok(args[1].endsWith(`...${environment.GITHUB_SHA}`));
          return Array.isArray(relation) ? relation.shift() : relation;
        }
        assert.equal(args[1], 'repos/source/repo/contents/last-sha-coder-stable');
        updates.push(JSON.parse(options.input));
        if (conflict) throw Object.assign(new Error('conflict'), { stderr: 'HTTP 409' });
        return '{}';
      },
    },
  });
  return updates;
}

test('baseline advances only from an ancestor and equal-source retries do not write', () => {
  const [update] = saveBaseline();
  assert.equal(update.sha, 'blob-1');
  assert.equal(update.branch, 'release-meta');
  assert.equal(Buffer.from(update.content, 'base64').toString(), `${environment.GITHUB_SHA}\n`);
  assert.deepEqual(saveBaseline({ previous: environment.GITHUB_SHA }), []);
  assert.equal(saveBaseline({ previous: null })[0].sha, undefined);
  for (const relation of ['behind', 'diverged']) assert.throws(() => saveBaseline({ relation }), /rewind or diverge/);
  assert.throws(() => saveBaseline({ previous: 'invalid' }), /Invalid Coder source baseline/);
});

test('baseline rereads after a conflict and never overwrites a concurrent newer SHA', () => {
  assert.equal(saveBaseline({ conflict: true, next: environment.GITHUB_SHA }).length, 1);
  assert.throws(() => saveBaseline({ conflict: true, next: 'c'.repeat(40), relation: ['ahead', 'behind'] }), /rewind or diverge/);
  assert.throws(() => saveBaseline({ conflict: true }), /conflict/);
});

test('artifacts support same-run retries and stable verification waits for domestic synchronization', () => {
  const uploads = Object.values(workflow.jobs).flatMap(job => job.steps).filter(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(uploads.length, 4);
  assert.ok(uploads.every(step => step.with.overwrite === true));
  assert.equal(workflow.jobs['prepare-release'].needs, 'prepare');
  assert.ok(!workflow.jobs['prepare-release'].steps.some(step => step.uses === 'actions/download-artifact@v4'));
  assert.ok(workflow.jobs['publish-release'].needs.includes('prepare-release'));
  assert.equal(step('publish-release', 'Upload all four packages and product manifests to a draft').with.draft, true);
  assert.deepEqual(workflow.jobs['sync-stable-feed'].needs, ['prepare', 'upload-stable-feed']);
  assert.equal(workflow.jobs['sync-stable-feed'].if, "needs.prepare.outputs.channel == 'stable'");
  assert.deepEqual(workflow.jobs['verify-stable-feed'].needs, ['prepare', 'sync-stable-feed']);
  const syncWorkflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/coder-sync.yml'), 'utf8'));
  for (const source of [workflow, syncWorkflow]) {
    assert.deepEqual(source.jobs['sync-stable-feed'].steps[0].env, {
      SERVER_HOST: '${{ secrets.TRIGGER_SERVER_HOST }}', SERVER_USER: '${{ secrets.TRIGGER_SERVER_USER }}',
      SERVER_PASSWORD: '${{ secrets.TRIGGER_SERVER_PASSWORD }}', SERVER_SCRIPT_PATH: '${{ secrets.TRIGGER_CODER_SERVER_SCRIPT_PATH }}',
    });
  }
});
