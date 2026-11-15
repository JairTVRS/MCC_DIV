import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Código único de cada build. O app guarda o seu (__BUILD_ID__) e compara com o /versao.json publicado:
// se mudou, há versão nova no ar e o app se atualiza sozinho.
const BUILD_ID = Date.now().toString(36);

function versaoJson(): Plugin {
  return {
    name: 'versao-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'versao.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versaoJson()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Docs/ guarda arquivos do Jair (logos etc.), não código: vigiar essa pasta derrubava o
  // servidor local com EBUSY quando um arquivo dela estava aberto em outro programa.
  server: { watch: { ignored: ['**/Docs/**', '**/supabase/**'] } },
});
