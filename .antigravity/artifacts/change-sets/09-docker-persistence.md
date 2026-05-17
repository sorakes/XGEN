# Change Set: Persistência de Dados no Docker (Opção 3)

## Arquivos Modificados
1. `docker-compose.yml`
2. `supervisord.conf`

## Descrição da Mudança
- Foram adicionados dois Docker Volumes nomeados (`xgen_db_data` e `xgen_redis_data`) para isolar o armazenamento de dados.
- O mapeamento do SQLite foi direcionado para `/app/apps/api/prisma`.
- O mapeamento do Redis foi direcionado para `/var/lib/redis`.
- O script de inicialização do Redis no `supervisord.conf` foi alterado para incluir as flags `--dir /var/lib/redis` e `--appendonly yes`, garantindo que o Redis escreva sua fila ativamente no disco antes do contêiner ser desligado.

## Impacto no Sistema
**Alta criticidade resolvida.** O reset ou atualização da imagem do Docker não irá mais deletar as chaves de API, logs de execução (SQLite) e tarefas pendentes (Redis). O comportamento atende agora as melhores práticas de infraestrutura corporativa isolada.
