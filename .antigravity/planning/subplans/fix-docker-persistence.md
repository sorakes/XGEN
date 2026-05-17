# Subplan: Correção de Persistência de Dados (Docker Volumes)

## Objetivo
Implementar a **Opção 3 (Segura)** para evitar a perda de dados ao resetar o Docker.

## Escopo Atômico
1. **docker-compose.yml**:
   - Adicionar o bloco `volumes` de top-level definindo `xgen_db_data` e `xgen_redis_data`.
   - Mapear `xgen_db_data` para `/app/apps/api/prisma`.
   - Mapear `xgen_redis_data` para `/var/lib/redis`.

2. **supervisord.conf**:
   - Atualizar a inicialização do `redis-server` para garantir a persistência em disco na pasta designada:
     `command=redis-server --dir /var/lib/redis --appendonly yes`

## Critérios de Aceitação
- Após destruir e recriar o contêiner (`docker-compose down && docker-compose up -d --build`), os dados de banco e da fila devem estar intactos.
- Sem permissões conflitantes com o host Windows (benefício de Docker Volumes).

## Status
[INVALIDATED - PIVOT]
