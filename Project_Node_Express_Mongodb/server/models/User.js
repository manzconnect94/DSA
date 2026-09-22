// ============================================================
// 🧠 CONCEPT: Mongoose schema — validation, indexes, hooks, methods
// WHY IT MATTERS (interview angle): MongoDB itself is schemaless. Mongoose
//   adds an APPLICATION-LEVEL schema: types, required fields, defaults,
//   validators and middleware. The interview follow-up is "so is MongoDB
//   schemaless or not?" — the honest answer is that the data store imposes
//   no schema, but virtually every real app imposes one in the application
//   layer, because without it a single bad deploy writes garbage documents
//   that live in your collection forever.
// HOW IT WORKS HERE: the User model owns password hashing (pre-save hook),
//   password comparison (instance method) and role-based fields.
// ============================================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/env');

// ============================================================
// 🧠 CONCEPT: bcryptjs vs bcrypt
// WHY IT MATTERS (interview angle): `bcrypt` is a native C++ addon — faster,
//   but it needs node-gyp and a compiler toolchain, which breaks Windows
//   installs and slim Docker images. `bcryptjs` is a pure-JS implementation:
//   same algorithm and same hash format (they are interchangeable), roughly
//   30% slower. For a study/boilerplate repo that must install anywhere,
//   bcryptjs is the pragmatic choice. In a high-traffic production login
//   path you'd use native bcrypt or argon2.
//   ⚠️ And whichever you pick: bcrypt is CPU-bound, so a high cost factor
//   blocks the event loop. This is a genuine reason to run multiple workers
//   (cluster.js) in front of a login-heavy service.
// ============================================================

const ROLES = ['user', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'], // custom message -> nicer API errors
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name must be at most 80 characters'],
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      // ============================================================
      // 🧠 CONCEPT: `unique: true` is an INDEX, not a validator
      // WHY IT MATTERS (interview angle): a favourite gotcha. `unique` does
      //   not run any validation in Mongoose — it tells MongoDB to build a
      //   unique index. So a duplicate insert does not produce a friendly
      //   ValidationError; it produces a raw MongoServerError with
      //   `code: 11000`. Your error middleware must translate that into a
      //   409 (we do — see middleware/errorHandler.js). Second gotcha: the
      //   index is only built when Mongoose autoIndexes or you build it
      //   manually, so in production (where autoIndex should be off) a
      //   forgotten migration means the constraint silently does not exist.
      // ============================================================
      unique: true,
      lowercase: true, // normalise BEFORE the unique check, or Bob@x.com and bob@x.com both fit
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      // ============================================================
      // 🧠 CONCEPT: `select: false` — exclude a field by default
      // WHY IT MATTERS (interview angle): defence in depth against the
      //   classic "we accidentally returned the password hash in the API
      //   response" bug. With select:false the field is omitted from EVERY
      //   query unless explicitly requested with .select('+password').
      //   You cannot forget it on a new endpoint, because the default is safe.
      // HOW IT WORKS HERE: only the login controller opts back in.
      // ============================================================
      select: false,
    },

    // ============================================================
    // 🧠 CONCEPT: RBAC — the role field is the authorization primitive
    // WHY IT MATTERS (interview angle): authentication proves WHO you are;
    //   authorization decides WHAT you may do. This single field is the
    //   entire basis of the requireRole() middleware. `enum` guarantees no
    //   one can write role:'superadmin' and invent a privilege tier.
    //   ⚠️ Critically, this field must NEVER be settable from a request body
    //   — see the mass-assignment comment in controllers/authController.js.
    // ============================================================
    role: {
      type: String,
      enum: { values: ROLES, message: '{VALUE} is not a valid role' },
      default: 'user',
      index: true, // admin listings filter on this
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    avatarUrl: {
      type: String,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    // ============================================================
    // 🧠 CONCEPT: A "password changed at" timestamp for token invalidation
    // WHY IT MATTERS (interview angle): a great answer to "you said you
    //   can't revoke a JWT access token — so what if someone steals my
    //   password and I change it?" Store the change time; in
    //   verifyAccessToken, reject any token whose `iat` predates it. You've
    //   added a targeted revocation check at the cost of one DB lookup —
    //   and you can skip that lookup for most requests by only doing it on
    //   sensitive routes.
    // HOW IT WORKS HERE: maintained by the pre-save hook below.
    // ============================================================
    passwordChangedAt: {
      type: Date,
      default: null,
    },
  },
  {
    // ============================================================
    // 🧠 CONCEPT: timestamps option
    // WHY IT MATTERS (interview angle): adds createdAt/updatedAt maintained
    //   by Mongoose. Note updatedAt is only touched by Mongoose-issued
    //   writes — a direct driver update or a Mongo shell edit bypasses it.
    // ============================================================
    timestamps: true,

    // ============================================================
    // 🧠 CONCEPT: toJSON transform — shaping the API response at the model
    // WHY IT MATTERS (interview angle): res.json(user) calls toJSON()
    //   internally. Putting the transform here means EVERY endpoint that
    //   ever returns a user gets the safe shape for free — you cannot leak
    //   the hash from a route someone adds next year. The alternative
    //   (remembering to build a DTO in each controller) fails eventually.
    // HOW IT WORKS HERE: drop password/__v, rename _id -> id for the React
    //   client (which shouldn't care about Mongo's field naming).
    // ============================================================
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.password;
        return ret;
      },
    },
  }
);

// ============================================================
// 🧠 CONCEPT: Virtuals — computed fields that are never stored
// WHY IT MATTERS (interview angle): a virtual is derived at read time, so it
//   costs zero storage and can never go stale. The trade-off: you CANNOT
//   query or index a virtual, because MongoDB has no idea it exists.
//   `User.find({ initials: 'MH' })` matches nothing. If you need to query it,
//   it must be a real (denormalised) field.
// ============================================================
userSchema.virtual('initials').get(function getInitials() {
  if (!this.name) return '';
  return this.name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .slice(0, 2)
    .join('');
});

// ============================================================
// 🧠 CONCEPT: pre('save') middleware — hashing passwords in ONE place
// WHY IT MATTERS (interview angle): "Where do you hash the password?" If the
//   answer is "in the register controller", the follow-up writes itself:
//   what about the reset-password route, the admin-creates-user route, and
//   the seed script? Each is a chance to store plaintext. Putting it in a
//   pre-save hook makes it structurally impossible to save an unhashed
//   password through Mongoose.
//   ⚠️ The catch worth naming: document middleware does NOT run on
//   `updateOne` / `findOneAndUpdate` / `insertMany`, because those operate
//   on the query, not a document. A password change done via
//   findByIdAndUpdate would bypass this hook entirely and save plaintext.
//   That is why the change-password flow in this app loads the doc and calls
//   .save().
// HOW IT WORKS HERE: hash only when the password field actually changed.
// ============================================================
userSchema.pre('save', async function hashPassword(next) {
  // isModified is essential. Without it, every save() — even one that only
  // updates lastLoginAt — would re-hash the ALREADY-HASHED password,
  // producing a hash-of-a-hash and locking the user out permanently.
  if (!this.isModified('password')) return next();

  try {
    // ============================================================
    // 🧠 CONCEPT: Salting, and why bcrypt needs no salt column
    // WHY IT MATTERS (interview angle): a salt is random data mixed into the
    //   hash so identical passwords produce DIFFERENT hashes. That defeats
    //   rainbow tables and stops an attacker seeing that 500 users share the
    //   password "123456". bcrypt GENERATES the salt itself and EMBEDS it in
    //   the output string:
    //       $2a$10$N9qo8uLOickgx2ZMRZoMye.IjZAgcfl7p92ldGxad68LJZdL17lhW
    //        │  │  └── 22-char salt ──┘└──────── 31-char hash ─────────┘
    //        │  └─ cost factor (10 = 2^10 = 1024 iterations)
    //        └─ algorithm version
    //   So you store ONE string and never need a separate salt column —
    //   compare() reads the cost and salt back out of the stored hash.
    //   This also means you can raise the cost factor over time and rehash
    //   users transparently on their next successful login.
    // ============================================================
    this.password = await bcrypt.hash(this.password, config.security.bcryptSaltRounds);

    // Only set this on a genuine CHANGE, not on initial creation.
    if (!this.isNew) {
      // Backdate by a second: the JWT `iat` claim has 1-second resolution, so
      // a token issued in the same second as the change could otherwise be
      // wrongly rejected (or wrongly accepted). Classic off-by-one.
      this.passwordChangedAt = new Date(Date.now() - 1000);
    }

    return next();
  } catch (err) {
    return next(err); // pass to Mongoose -> surfaces as a rejected save()
  }
});

// ============================================================
// 🧠 CONCEPT: Instance methods vs statics
// WHY IT MATTERS (interview angle): an INSTANCE method operates on one
//   document (`user.comparePassword(...)`); a STATIC operates on the model
//   (`User.findByEmail(...)`). Both keep data logic on the model instead of
//   smeared across controllers — the "fat model, thin controller" idea.
//   ⚠️ Must be a regular `function`, never an arrow function: arrows have no
//   own `this`, so `this` would not be the document.
// ============================================================
userSchema.methods.comparePassword = async function comparePassword(candidate) {
  // ============================================================
  // 🧠 CONCEPT: Timing-safe comparison
  // WHY IT MATTERS (interview angle): bcrypt.compare does a constant-time
  //   comparison internally. If you instead did `hash(candidate) === stored`
  //   with ===, the string comparison short-circuits on the first differing
  //   byte, and an attacker could in principle measure response times to
  //   learn the hash byte by byte (a timing attack). Never compare secrets
  //   with ===; use bcrypt.compare or crypto.timingSafeEqual.
  // ============================================================
  if (!this.password) {
    throw new Error('Password field not selected — use .select("+password")');
  }
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.passwordChangedAfter = function passwordChangedAfter(jwtIssuedAtSeconds) {
  if (!this.passwordChangedAt) return false;
  const changedAtSeconds = Math.floor(this.passwordChangedAt.getTime() / 1000);
  return changedAtSeconds > jwtIssuedAtSeconds;
};

userSchema.statics.findByEmail = function findByEmail(email, { withPassword = false } = {}) {
  const query = this.findOne({ email: String(email).toLowerCase().trim() });
  // Opt back into the select:false password field, only where it's needed.
  return withPassword ? query.select('+password') : query;
};

// ============================================================
// 🧠 CONCEPT: Explicit index declaration + autoIndex in production
// WHY IT MATTERS (interview angle): Mongoose builds declared indexes at boot
//   by default (`autoIndex: true`). That is convenient in dev and DANGEROUS
//   in production: on a collection with millions of documents, building an
//   index at startup can lock/slow the database for minutes while your new
//   pods sit there "starting". Standard practice is autoIndex:false in prod
//   and creating indexes deliberately via a migration, ideally with
//   `background: true`.
// HOW IT WORKS HERE: email already has a unique index from `unique: true`.
//   We add a compound one for the admin user-list screen.
// ============================================================
userSchema.index({ role: 1, createdAt: -1 });

if (config.isProd) {
  userSchema.set('autoIndex', false);
}

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
