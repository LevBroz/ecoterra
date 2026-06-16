// Configuración pública del frontend.
// La anon key es segura de exponer: RLS protege los datos.
export const SUPABASE_URL = 'https://njkykdaiubqcodxhqmrc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qa3lrZGFpdWJxY29keGhxbXJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjgxODksImV4cCI6MjA5NjcwNDE4OX0.l-5jEkf2zQ8l172nIHQxDDK9pMRcyC2AWOoHf_JPreY';

// URL del backend en Render (en local: http://localhost:3001)
export const API_URL = 'https://ecoterra-bung.onrender.com';

// URL pública del sitio web (Netlify). Se usa para armar el enlace del pase
// que el residente comparte por WhatsApp: el visitante lo abre en su navegador.
// OJO: en la APK no se puede usar location.origin (sería el WebView local),
// por eso se fija aquí la URL real y accesible.
export const PUBLIC_WEB_URL = 'https://ecoterra1.netlify.app';
