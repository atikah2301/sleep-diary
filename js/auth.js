import { supabase } from "./supabase-client.js";
import { SHARED_LOGIN_EMAIL } from "./config.js";

/** The login screen asks for the one shared password, used for the one shared
 * Supabase Auth user behind the scenes. */
export async function signIn(password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: SHARED_LOGIN_EMAIL,
    password,
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
