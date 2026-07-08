# План перевода .sh файлов на русский

## Information Gathered
- В репозитории найдены только 2 шелл-скрипта `.sh`: `linux.sh` и `mac.sh`.
- Оба скрипта содержат англоязычные строки в комментариях и (главное) в `echo`/`read`/сообщениях вида `[ERROR]`.
- Логика скриптов должна остаться неизменной: меняются только текстовые сообщения для пользователя.

## Plan (по файлам)
### 1) `mac.sh`
- Оставить структуру/логику bash без изменений.
- Перевести англоязычные строки:
  - `Uncensored AI Studio required a quick repair...` и прочие сообщения в блоке `SETUP_REASON`.
  - Сообщения в разделе запуска: `Launching...`, `Running!`, `GPU API...`, `Text API...`, `Speech/TTS...`, prompt/ошибки.
  - Любые `[ERROR] ...` и подсказки `Press Enter...`.
- При необходимости привести формулировки к единому стилю (RU-локализация терминов, например «Текстовый API» и «GPU API»).

### 2) `linux.sh`
- Оставить структуру/логику bash без изменений.
- Перевести англоязычные строки аналогично `mac.sh`:
  - `This looks like your first run...` и `Uncensored AI Studio needs a quick repair...`.
  - Ошибки `[ERROR] ...`.
  - Сообщения запуска/статуса: `Launch`, `Launching`, `Starting...`, `Running!`, `GPU API...`, `Text API...`, `Press Ctrl+C...`.

## Dependent Files to be edited
- `mac.sh`
- `linux.sh`

## Followup steps
- Запустить быстрый синтаксический прогон: `bash -n mac.sh linux.sh`.
- (Опционально) если доступен `shellcheck`, прогнать `shellcheck mac.sh linux.sh`.

## <ask_followup_question>
Подтверждено: нужно переводить также комментарии/описания в `.sh` файлах.
</ask_followup_question>


