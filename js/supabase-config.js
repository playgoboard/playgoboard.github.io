// Where the GoBoard database lives (Supabase). The "anon" key is meant to be public:
// every Supabase website puts it in its pages. What players may read or change is
// controlled by the rules in supabase/*.sql, not by keeping this key secret.
// NEVER put the service_role / secret key in this file.
window.GOBOARD_SUPABASE = {
  url: "https://iosvimeihfhpxsztqkkv.supabase.co",
  anonKey: "sb_publishable_wk2cNeEd2YpQKgq14q7-kA_Tmxf5dr3",
};
