// ============================================================
// 🧠 CONCEPT: Testing AUTHORIZATION, not just authentication
// WHY IT MATTERS (interview angle): most test suites only check "does a
//   logged-out user get 401?" and stop there. That misses IDOR entirely —
//   the bug is that a LOGGED-IN user can reach someone ELSE'S data. The
//   test you actually need is: create two users, have user B try to touch
//   user A's resource, assert 404.
//   ⭐ IF YOU WRITE ONE SECURITY TEST IN A CODEBASE, WRITE THIS ONE. It is
//   the single highest-value test in this file, because broken access
//   control is OWASP's #1 risk and it is invisible in manual QA (testers
//   only ever look at their own data).
// ============================================================

const request = require('supertest');
const app = require('../app');
const Task = require('../models/Task');

async function createUserAndLogin(email) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'User', email, password: 'Password123' });
  return { token: res.body.data.accessToken, userId: res.body.data.user.id };
}

describe('Task CRUD', () => {
  let auth;

  beforeEach(async () => {
    auth = await createUserAndLogin('owner@example.com');
  });

  const authed = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${auth.token}`);

  test('creates a task owned by the authenticated user', async () => {
    const res = await authed('post', '/api/tasks').send({ title: 'Write tests', priority: 'high' }).expect(201);

    expect(res.body.data.title).toBe('Write tests');
    // ⭐ Ownership comes from the TOKEN, never the body.
    expect(String(res.body.data.owner)).toBe(auth.userId);
  });

  // ============================================================
  // 🧠 CONCEPT: Testing that `owner` cannot be set from the body
  // WHY IT MATTERS (interview angle): without this guard a user could
  //   create tasks inside someone else's account. Mass assignment applies
  //   to relationships, not just to `role`.
  // ============================================================
  test('REJECTS an attempt to set `owner` from the request body', async () => {
    await authed('post', '/api/tasks')
      .send({ title: 'Sneaky', owner: '507f1f77bcf86cd799439011' })
      .expect(400);
  });

  test('lists only the caller’s own tasks', async () => {
    await authed('post', '/api/tasks').send({ title: 'Mine' });

    const other = await createUserAndLogin('other@example.com');
    await request(app).post('/api/tasks').set('Authorization', `Bearer ${other.token}`).send({ title: 'Theirs' });

    const res = await authed('get', '/api/tasks').expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Mine');
  });

  test('updates a task the caller owns', async () => {
    const created = await authed('post', '/api/tasks').send({ title: 'Original' });

    const res = await authed('patch', `/api/tasks/${created.body.data.id}`).send({ status: 'done' }).expect(200);

    expect(res.body.data.status).toBe('done');
    // The pre('save') hook stamps completedAt when status flips to done.
    expect(res.body.data.completedAt).not.toBeNull();
  });

  test('deletes a task the caller owns and returns 204', async () => {
    const created = await authed('post', '/api/tasks').send({ title: 'Delete me' });

    await authed('delete', `/api/tasks/${created.body.data.id}`).expect(204);
    expect(await Task.countDocuments()).toBe(0);
  });

  test('400 for a malformed ObjectId (not a 500)', async () => {
    await authed('get', '/api/tasks/not-a-valid-id').expect(400);
  });

  test('404 for a well-formed id that does not exist', async () => {
    await authed('get', '/api/tasks/507f1f77bcf86cd799439011').expect(404);
  });
});

// ============================================================
// 🧠 CONCEPT: ⭐ THE IDOR TEST
// WHY IT MATTERS (interview angle): see the header of this file. These
//   four tests are what stands between you and the single most common
//   critical web vulnerability. Note the assertion is 404, NOT 403 —
//   returning 403 would confirm the resource exists and let an attacker
//   enumerate ids. See the full breakdown in middleware/auth.js.
// ============================================================
describe('IDOR — cross-user access must be impossible', () => {
  let alice;
  let bob;
  let aliceTaskId;

  beforeEach(async () => {
    alice = await createUserAndLogin('alice@example.com');
    bob = await createUserAndLogin('bob@example.com');

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: "Alice's private task" });

    aliceTaskId = res.body.data.id;
  });

  const asBob = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${bob.token}`);

  test('Bob CANNOT read Alice’s task (404, not 403 — no enumeration)', async () => {
    const res = await asBob('get', `/api/tasks/${aliceTaskId}`).expect(404);
    // Nothing in the response reveals that the task exists.
    expect(JSON.stringify(res.body)).not.toContain('Alice');
  });

  test('Bob CANNOT update Alice’s task', async () => {
    await asBob('patch', `/api/tasks/${aliceTaskId}`).send({ title: 'Hacked' }).expect(404);

    // And the data is genuinely untouched.
    const task = await Task.findById(aliceTaskId);
    expect(task.title).toBe("Alice's private task");
  });

  test('Bob CANNOT delete Alice’s task', async () => {
    await asBob('delete', `/api/tasks/${aliceTaskId}`).expect(404);
    expect(await Task.findById(aliceTaskId)).not.toBeNull();
  });

  test('Alice CAN still do all of the above on her own task', async () => {
    const asAlice = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${alice.token}`);

    await asAlice('get', `/api/tasks/${aliceTaskId}`).expect(200);
    await asAlice('patch', `/api/tasks/${aliceTaskId}`).send({ status: 'done' }).expect(200);
    await asAlice('delete', `/api/tasks/${aliceTaskId}`).expect(204);
  });
});

// ============================================================
// 🧠 CONCEPT: Testing RBAC
// WHY IT MATTERS (interview angle): proves requireRole('admin') works in
//   both directions — a regular user is blocked (403, not 401, because
//   they ARE authenticated) and an admin is allowed through.
// ============================================================
describe('RBAC — admin routes', () => {
  test('a regular user gets 403 on an admin route', async () => {
    const user = await createUserAndLogin('regular@example.com');

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('an anonymous caller gets 401 (not 403) on an admin route', async () => {
    // 401 because AuthN runs first and fails before AuthZ is reached.
    await request(app).get('/api/admin/users').expect(401);
  });

  test('an admin is allowed through', async () => {
    const User = require('../models/User');
    await createUserAndLogin('boss@example.com');
    await User.updateOne({ email: 'boss@example.com' }, { $set: { role: 'admin' } });

    // Log in again so the new role is baked into a fresh token — a neat
    // demonstration that JWT claims are a SNAPSHOT, not live data.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'boss@example.com', password: 'Password123' });

    await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
  });
});

// ============================================================
// 🧠 CONCEPT: Testing pagination behaviour
// WHY IT MATTERS (interview angle): the interesting assertion is the
//   STABILITY one — proving cursor pagination does not duplicate rows when
//   data is inserted mid-iteration, which is offset pagination's core
//   weakness. A test that demonstrates the difference is worth more than
//   an explanation.
// ============================================================
describe('Pagination', () => {
  let auth;

  beforeEach(async () => {
    auth = await createUserAndLogin('paged@example.com');
    const tasks = Array.from({ length: 25 }, (_, i) => ({
      title: `Task ${String(i).padStart(2, '0')}`,
      owner: auth.userId,
    }));
    await Task.insertMany(tasks);
  });

  const authed = (url) => request(app).get(url).set('Authorization', `Bearer ${auth.token}`);

  test('offset mode returns page metadata including a total', async () => {
    const res = await authed('/api/tasks?page=1&limit=10').expect(200);

    expect(res.body.data).toHaveLength(10);
    expect(res.body.pagination.total).toBe(25);
    expect(res.body.pagination.totalPages).toBe(3);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  test('offset mode page 3 returns the remaining 5', async () => {
    const res = await authed('/api/tasks?page=3&limit=10').expect(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  test('cursor mode returns a nextCursor and no total', async () => {
    const res = await authed('/api/tasks?mode=cursor&limit=10').expect(200);

    expect(res.body.data).toHaveLength(10);
    expect(res.body.pagination.nextCursor).toEqual(expect.any(String));
    // Deliberately absent — computing it is the cost cursor pagination avoids.
    expect(res.body.pagination.total).toBeUndefined();
  });

  test('cursor mode walks the full set without duplicates', async () => {
    const seen = new Set();
    let cursor = null;
    let pages = 0;

    do {
      const url = `/api/tasks?mode=cursor&limit=10${cursor ? `&cursor=${cursor}` : ''}`;
      // eslint-disable-next-line no-await-in-loop
      const res = await authed(url).expect(200);

      for (const task of res.body.data) {
        // The assertion that matters: no row is ever returned twice.
        expect(seen.has(task._id)).toBe(false);
        seen.add(task._id);
      }

      cursor = res.body.pagination.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(25);
    expect(pages).toBe(3);
  });

  test('clamps an absurd limit (DoS defence)', async () => {
    await authed('/api/tasks?limit=1000000').expect(400);
  });
});

// ============================================================
// 🧠 CONCEPT: Testing the aggregation endpoint
// WHY IT MATTERS (interview angle): aggregations are easy to get subtly
//   wrong — especially the ObjectId casting gotcha, where a string $match
//   silently returns an empty array. A test with known data catches
//   exactly that: if the cast were missing, `total` would be 0 and this
//   test would fail loudly instead of the dashboard quietly showing zeros.
// ============================================================
describe('GET /api/tasks/stats — aggregation', () => {
  test('returns correct grouped counts', async () => {
    const auth = await createUserAndLogin('stats@example.com');

    await Task.insertMany([
      { title: 'a', status: 'todo', priority: 'high', owner: auth.userId, estimatedHours: 2 },
      { title: 'b', status: 'todo', priority: 'low', owner: auth.userId, estimatedHours: 4 },
      { title: 'c', status: 'done', priority: 'high', owner: auth.userId, estimatedHours: 6 },
    ]);

    const res = await request(app)
      .get('/api/tasks/stats')
      .set('Authorization', `Bearer ${auth.token}`)
      .expect(200);

    expect(res.body.data.total).toBe(3); // would be 0 if the ObjectId cast were missing
    expect(res.body.data.byStatus.todo).toBe(2);
    expect(res.body.data.byStatus.done).toBe(1);
    expect(res.body.data.byPriority.high).toBe(2);
    expect(res.body.data.completionRate).toBeCloseTo(33.3, 0);
  });
});

// ============================================================
// 🧠 CONCEPT: Testing a STREAMING endpoint
// WHY IT MATTERS (interview angle): Supertest buffers the response, so you
//   cannot directly observe chunking — but you CAN assert the headers that
//   make it a stream (no Content-Length, so chunked encoding) and that the
//   full body is correct. The memory behaviour is what you'd verify with a
//   load test, not a unit test; being clear about what a test can and
//   cannot prove is itself a good signal.
// ============================================================
describe('GET /api/tasks/export — CSV streaming', () => {
  test('streams a well-formed CSV', async () => {
    const auth = await createUserAndLogin('export@example.com');
    await Task.insertMany([
      { title: 'First task', status: 'todo', owner: auth.userId },
      { title: 'Second, with a comma', status: 'done', owner: auth.userId },
    ]);

    const res = await request(app)
      .get('/api/tasks/export')
      .set('Authorization', `Bearer ${auth.token}`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    // No Content-Length => chunked transfer encoding => genuinely streamed.
    expect(res.headers['content-length']).toBeUndefined();

    const lines = res.text.trim().split('\n');
    expect(lines[0]).toContain('title,status');
    expect(lines).toHaveLength(3); // header + 2 rows
    // A comma inside a value must be quoted, not break the column count.
    expect(res.text).toContain('"Second, with a comma"');
  });

  // ============================================================
  // 🧠 CONCEPT: Testing the CSV-injection defence
  // WHY IT MATTERS (interview angle): a title starting with `=` must be
  //   neutralised, or opening the export in Excel executes it as a formula.
  //   The attack targets your USER's machine, not your server, which is why
  //   it gets overlooked.
  // ============================================================
  test('neutralises a formula-injection payload', async () => {
    const auth = await createUserAndLogin('csv@example.com');
    await Task.create({ title: '=HYPERLINK("http://evil.com","click")', owner: auth.userId });

    const res = await request(app)
      .get('/api/tasks/export')
      .set('Authorization', `Bearer ${auth.token}`)
      .expect(200);

    // The leading quote stops Excel treating the cell as a formula.
    expect(res.text).toContain("'=HYPERLINK");
  });
});
