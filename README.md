# pc-mcp

MCP que pone carpetas de una PC a disposición de un agente (agent-runtime u otro cliente MCP): leer, buscar y escribir archivos.

Dos modos:

- **Docker (recomendado):** `docker compose up` levanta todo: agent-runtime (imágenes de ghcr.io) + pc-mcp con tu carpeta montada en `/workspace`.
- **Nativo:** pc-mcp corre en Windows (`npm run dev`) con rutas reales, y agent-runtime lo encuentra en `host.docker.internal:3020`.

## Herramientas

| Tool | Qué hace |
|------|----------|
| `list_roots` | Carpetas habilitadas y modo |
| `list_dir` | Árbol de una carpeta (hasta 3 niveles) |
| `read_file` | Texto con números de línea; `offset` / `limit` para archivos largos |
| `find_files` | Archivos por glob (`**/*.ts`) |
| `search_text` | Regex o texto literal dentro de archivos |
| `internet_search` | Busca en la web con Brave Search (requiere API key) y devuelve fragmentos y URLs |
| `write_file` | Crea o reemplaza un archivo (no existe con `PC_MCP_READ_ONLY=true`) |
| `edit_file` | Reemplazo de texto exacto (no existe con `PC_MCP_READ_ONLY=true`) |

En agent-runtime aparecen como `pc__read_file`, etc.

## Límites de seguridad

- Nada fuera de `PC_MCP_ROOTS`. Rutas con `..` o symlinks/junctions que salen de la carpeta se rechazan.
- Secretos bloqueados para leer y escribir: `.env`, `.env.*` (salvo `.env.example`), `*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa*`, `.npmrc`. Lo que lee el agente viaja al proveedor del modelo.
- No escribe dentro de `.git`. Búsquedas y listados no entran en `node_modules`, `.git`, `dist`, etc.
- `/mcp` exige `Authorization: Bearer <PC_MCP_TOKEN>`. Nativo escucha en `127.0.0.1` (Docker Desktop llega por `host.docker.internal`); en Docker no publica puerto.
- En Docker solo existe la carpeta montada: aunque falle un control, no hay nada más del disco adentro del contenedor.
- No corre comandos.
- `internet_search` envía la consulta a Brave Search y devuelve fragmentos/URLs; no abre páginas. Los resultados externos son contenido no confiable. La tool solo se registra si configurás `PC_MCP_BRAVE_API_KEY`.

## Uso con Docker

```powershell
Copy-Item .env.example .env   # completar PC_MCP_TOKEN, PC_MCP_WORKSPACE y AI_CONFIG
# Para habilitar búsqueda web, completar PC_MCP_BRAVE_API_KEY en .env
docker compose up -d --build  # http://localhost:3010
docker compose logs -f pc-mcp # ver qué hace el agente
```

- Solo la UI se publica, en `127.0.0.1`. pc-mcp y el Memory MCP quedan en la red interna.
- El agente ve tu carpeta como `/workspace` (usá rutas relativas: `pc-mcp/package.json`).
- Proyecto Compose `pc-agent`: no choca con el compose de desarrollo de agent-runtime, salvo el puerto. Si el 3010 está ocupado: `AGENT_RUNTIME_PORT=3011` en `.env`.
- Actualizar agent-runtime: `docker compose pull; docker compose up -d`.

### Con agent-runtime desde tu clon local

`docker-compose.local.yml` reemplaza las imágenes de ghcr.io por un build de tu clon (por defecto `../agent-runtime/agent-runtime`; otra ruta con `AGENT_RUNTIME_SRC` en `.env`):

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.local.yml watch   # recompila y recrea al guardar
```

Mismo proyecto, puerto y base que el modo imágenes: para volver, `docker compose up -d` (recrea agent-runtime y memory-mcp con las imágenes; las conversaciones quedan).

## Uso nativo

```powershell
npm install
Copy-Item .env.example .env   # completar PC_MCP_ROOTS y PC_MCP_TOKEN
npm run dev                   # o: npm run build; npm start
```

Cada llamada queda en la consola (`read_file pc-mcp/package.json ok 4ms`).

En modo nativo, en `agent-runtime/.env` va el mismo token (en Docker el compose ya lo arma):

```env
MCP_CONFIG={"pc":{"url":"http://host.docker.internal:3020/mcp","auth":null,"headers":{"Authorization":"Bearer <PC_MCP_TOKEN>"},"optional":true}}
```

`optional: true`: si pc-mcp está apagado, el chat sigue andando sin estas tools. Tras editar el `.env`: `docker compose up -d --force-recreate agent-runtime`.
