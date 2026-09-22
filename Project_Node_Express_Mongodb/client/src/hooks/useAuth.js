// ============================================================
// 🧠 CONCEPT: Re-exporting a hook to keep one import path
// WHY IT MATTERS (interview angle): the hook itself lives next to the
//   Context it reads (src/context/AuthContext.jsx), because they are
//   coupled. But consumers should import from a consistent `hooks/`
//   location — so if the implementation later moves to Zustand or Redux,
//   every component keeps importing `useAuth` from the same place and none
//   of them change. A small thing that makes a large refactor cheap.
// ============================================================

export { useAuth, default as AuthContext } from '../context/AuthContext';
export { useAuth as default } from '../context/AuthContext';
