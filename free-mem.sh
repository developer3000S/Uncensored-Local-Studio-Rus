#!/usr/bin/env bash
#
# Скрипт для очистки оперативной памяти и интерактивного закрытия ресурсоемких приложений на Linux.
# Требует прав суперпользователя (root).
#

set -euo pipefail

# Цветовое форматирование
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    echo -e "${RED}${BOLD}ОШИБКА:${NC} $*" >&2
    exit 1
}

# Проверка на права root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "Этот скрипт должен быть запущен с правами суперпользователя (root).\nПожалуйста, запустите: sudo $0"
    fi
}

# Красивое отображение состояния памяти с прогресс-баром
show_mem_status() {
    # Читаем данные из free -m
    local total used free shared buff_cache available
    # Достаем строку Mem: и парсим ее
    if ! read -r _ total used free shared buff_cache available < <(free -m | grep Mem:); then
        error "Не удалось получить данные об оперативной памяти."
    fi
    
    # Рассчитываем процент использования
    local percent=$(( 100 * used / total ))
    
    # Создаем прогресс-бар
    local bar_width=40
    local filled=$(( bar_width * percent / 100 ))
    local empty=$(( bar_width - filled ))
    
    local bar=""
    local i
    for ((i=0; i<filled; i++)); do bar="${bar}█"; done
    for ((i=0; i<empty; i++)); do bar="${bar}░"; done
    
    # Цвет индикатора в зависимости от нагрузки
    local bar_color="${GREEN}"
    if [[ $percent -gt 85 ]]; then
        bar_color="${RED}"
    elif [[ $percent -gt 60 ]]; then
        bar_color="${YELLOW}"
    fi
    
    echo -e "\n${CYAN}${BOLD}═══ Состояние оперативной памяти ═══${NC}"
    printf "${BOLD}Всего:${NC} %'d MB  |  ${BOLD}Использовано:${NC} %'d MB  |  ${BOLD}Доступно:${NC} %'d MB\n" "$total" "$used" "$available"
    echo -e "${BOLD}Загрузка:${NC} [${bar_color}${bar}${NC}] ${BOLD}${percent}%${NC}"
    echo -e "${CYAN}═════════════════════════════════════${NC}\n"
}

# Проверка приложений и интерактивное закрытие
check_and_kill_apps() {
    echo -e "${CYAN}${BOLD}═══ Анализ ресурсоемких приложений ═══${NC}"
    
    # Исключаемые PID: сам скрипт ($$), его родитель (sudo, $PPID), grandparent (shell), PID 1 (init)
    local my_pid=$$
    local parent_pid=$PPID
    local grandparent_pid=""
    if [[ -n "$parent_pid" ]]; then
        grandparent_pid=$(ps -o ppid= -p "$parent_pid" | tr -d ' ' || echo "")
    fi
    
    local real_user="${SUDO_USER:-root}"
    
    # Получаем топ процессов по потреблению RAM (RSS)
    # Формат: PID USER RSS COMMAND ARGS
    local ps_output
    if ! ps_output=$(ps -eo pid,user,rss,comm,args --sort=-rss | tail -n +2); then
        log "Предупреждение: не удалось получить список процессов."
        return
    fi
    
    local count=0
    local pids=()
    local mem_sizes=()
    local users=()
    local commands=()
    
    printf "${BOLD}%-4s %-8s %-12s %-15s %-30s${NC}\n" "№" "PID" "Память" "Пользователь" "Приложение"
    echo -e "${CYAN}--------------------------------------------------------------------------------${NC}"
    
    while read -r pid user rss comm args; do
        [[ -z "$pid" ]] && continue
        
        # Проверяем на исключение
        if [[ "$pid" -eq "$my_pid" || "$pid" -eq "$parent_pid" || "$pid" -eq 1 ]]; then
            continue
        fi
        if [[ -n "$grandparent_pid" && "$pid" -eq "$grandparent_pid" ]]; then
            continue
        fi
        
        local mem_mb=$((rss / 1024))
        
        # Фильтруем слишком мелкие процессы (меньше 15 MB) и системные треды с RSS=0
        if [[ $mem_mb -lt 15 ]]; then
            continue
        fi
        
        # Формируем имя для вывода
        local display_name="$comm"
        if [[ "$comm" == "python"* || "$comm" == "node" || "$comm" == "java" || "$comm" == "bash" || "$comm" == "sh" || "$comm" == "electron" ]]; then
            # Извлекаем краткие аргументы для лучшей узнаваемости
            local arg_part
            arg_part=$(echo "$args" | cut -d' ' -f2-)
            if [[ ${#arg_part} -gt 35 ]]; then
                arg_part="${arg_part:0:32}..."
            fi
            if [[ -n "$arg_part" ]]; then
                display_name="$comm ($arg_part)"
            fi
        else
            # Для браузеров и IDE
            if [[ "$comm" == "chrome" || "$comm" == "chromium" || "$comm" == "firefox" || "$comm" == "code" ]]; then
                if [[ "$args" =~ --type=([a-zA-Z0-9_-]+) ]]; then
                    display_name="$comm [${BASH_REMATCH[1]}]"
                fi
            fi
        fi
        
        count=$((count + 1))
        pids[count]="$pid"
        mem_sizes[count]="$mem_mb"
        users[count]="$user"
        commands[count]="$display_name"
        
        # Выделение пользователя цветом
        local user_color="${GREEN}"
        if [[ "$user" == "root" ]]; then
            user_color="${RED}"
        elif [[ "$user" != "$real_user" ]]; then
            user_color="${YELLOW}"
        fi
        
        local mem_str
        if [[ $mem_mb -ge 1024 ]]; then
            local mem_gb
            mem_gb=$(awk "BEGIN {printf \"%.1f\", $mem_mb / 1024}")
            mem_str="${mem_gb} GB"
        else
            mem_str="${mem_mb} MB"
        fi
        
        printf "%-4d %-8s %-12s %b%-15s%b %-30s\n" \
            "$count" \
            "$pid" \
            "$mem_str" \
            "$user_color" \
            "$user" \
            "${NC}" \
            "$display_name"
            
        if [[ $count -eq 10 ]]; then
            break
        fi
    done <<< "$ps_output"
    
    if [[ $count -eq 0 ]]; then
        echo -e "${GREEN}Нет активных приложений, использующих более 15MB RAM.${NC}"
        echo -e "${CYAN}══════════════════════════════════════${NC}\n"
        return
    fi
    
    echo -e "${CYAN}--------------------------------------------------------------------------------${NC}"
    echo -e "Введите номера приложений через пробел для их закрытия (например: 1 3)."
    read -rp "Или нажмите Enter, чтобы продолжить без закрытия: " choices
    
    if [[ -z "$choices" ]]; then
        echo -e "${YELLOW}Закрытие приложений пропущено.${NC}\n"
        return
    fi
    
    for idx in $choices; do
        if ! [[ "$idx" =~ ^[0-9]+$ ]] || [[ "$idx" -lt 1 ]] || [[ "$idx" -gt "$count" ]]; then
            echo -e "${YELLOW}Некорректный номер: '$idx'. Пропуск.${NC}"
            continue
        fi
        
        local target_pid="${pids[idx]}"
        local target_name="${commands[idx]}"
        local target_user="${users[idx]}"
        
        if ! kill -0 "$target_pid" 2>/dev/null; then
            echo -e "${YELLOW}Процесс $target_pid ($target_name) уже завершился.${NC}"
            continue
        fi
        
        if [[ "$target_user" == "root" ]]; then
            echo -e "${RED}${BOLD}ВНИМАНИЕ:${NC} Процесс ${BOLD}$target_name${NC} (PID: $target_pid) запущен под ${RED}root${NC}."
            read -rp "Вы действительно хотите закрыть его? [y/N]: " confirm
            if [[ ! "$confirm" =~ ^[YyДд]$ ]]; then
                log "Закрытие процесса $target_pid отменено."
                continue
            fi
        fi
        
        log "Мягкое закрытие (SIGTERM) процесса $target_name (PID: $target_pid)..."
        kill -15 "$target_pid" 2>/dev/null || true
        
        # Ждем завершения
        local wait_count=0
        local closed=false
        while [[ $wait_count -lt 3 ]]; do
            sleep 0.5
            if ! kill -0 "$target_pid" 2>/dev/null; then
                closed=true
                break
            fi
            wait_count=$((wait_count + 1))
        done
        
        if [[ "$closed" == "true" ]]; then
            log "${GREEN}Процесс $target_pid успешно закрыт.${NC}"
        else
            log "${YELLOW}Процесс не ответил. Отправка SIGKILL (принудительно)...${NC}"
            kill -9 "$target_pid" 2>/dev/null || true
            sleep 0.5
            if ! kill -0 "$target_pid" 2>/dev/null; then
                log "${GREEN}Процесс $target_pid принудительно закрыт.${NC}"
            else
                log "${RED}Ошибка: не удалось закрыть процесс $target_pid.${NC}"
            fi
        fi
    done
    echo -e "${CYAN}══════════════════════════════════════${NC}\n"
}

# Очистка кэшей памяти
clean_memory() {
    local level="$1"
    
    # Сброс грязных кэшей на диск перед очисткой (обязательно для безопасности данных)
    log "Сброс буферов записи на диск (sync)..."
    sync
    sleep 1

    case "$level" in
        "low"|"1"|"малая")
            log "Выполняется ${GREEN}малая${NC} очистка памяти (освобождение кэша страниц)..."
            if ! echo 1 > /proc/sys/vm/drop_caches; then
                error "Не удалось очистить кэш страниц. Проверьте права доступа."
            fi
            
            # Уплотнение памяти (сжатие фрагментированных страниц)
            if [[ -f /proc/sys/vm/compact_memory ]]; then
                log "Запуск уплотнения памяти (compact_memory)..."
                echo 1 > /proc/sys/vm/compact_memory || true
            fi
            ;;
            
        "medium"|"2"|"средняя")
            log "Выполняется ${YELLOW}средняя${NC} очистка памяти (освобождение кэша страниц, dentries и inodes)..."
            if ! echo 3 > /proc/sys/vm/drop_caches; then
                error "Не удалось очистить системные кэши. Проверьте права доступа."
            fi
            
            if [[ -f /proc/sys/vm/compact_memory ]]; then
                log "Запуск уплотнения памяти (compact_memory)..."
                echo 1 > /proc/sys/vm/compact_memory || true
            fi
            ;;
            
        "high"|"3"|"высокая")
            log "Выполняется ${RED}высокая${NC} очистка памяти (полная очистка кэшей, уплотнение и очистка SWAP)..."
            if ! echo 3 > /proc/sys/vm/drop_caches; then
                error "Не удалось очистить системные кэши. Проверьте права доступа."
            fi
            
            if [[ -f /proc/sys/vm/compact_memory ]]; then
                log "Запуск уплотнения памяти (compact_memory)..."
                echo 1 > /proc/sys/vm/compact_memory || true
            fi
            
            # Очистка SWAP (раздела/файла подкачки) с проверкой на доступную память
            if grep -q "swap" /proc/swaps; then
                # Получаем доступную оперативную память в килобайтах
                local free_ram
                free_ram=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
                if [[ -z "$free_ram" ]]; then
                    # Резервный вариант, если MemAvailable отсутствует
                    free_ram=$(free -k | awk '/Mem:/ {print $4 + $6 + $7}')
                fi
                
                # Получаем занятый объем SWAP в килобайтах
                local used_swap
                used_swap=$(awk '/SwapTotal/ {total=$2} /SwapFree/ {free=$2} END {print total-free}' /proc/meminfo)
                
                if [[ $used_swap -gt 0 ]]; then
                    # Сравниваем свободную RAM с занятым SWAP + 100MB запас безопасности
                    local safety_margin=102400
                    local required_ram=$((used_swap + safety_margin))
                    
                    if [[ $free_ram -gt $required_ram ]]; then
                        log "Очистка SWAP (перезапуск разделов подкачки)..."
                        if swapoff -a && swapon -a; then
                            log "SWAP успешно очищен."
                        else
                            log "Предупреждение: не удалось перезапустить SWAP."
                        fi
                    else
                        log "Предупреждение: Недостаточно свободной RAM ($((free_ram/1024))MB доступно < $(((used_swap + safety_margin)/1024))MB требуется) для безопасного отключения SWAP. Пропуск."
                    fi
                else
                    log "SWAP пуст или не используется."
                fi
            else
                log "SWAP не настроен в системе."
            fi
            ;;
            
        *)
            error "Неизвестный уровень очистки: $level"
            ;;
    esac
    
    log "Очистка завершена."
}

usage() {
    cat <<EOF
Использование: sudo $0 [опции] [уровень]

Опции:
  -h, --help       Показать эту справку
  -a, --apps       Запустить только проверку и закрытие ресурсоемких приложений
  -c, --clean      Запустить очистку кэшей без интерактивной проверки приложений

Уровни очистки (используются с --clean или напрямую):
  low, 1, малая      - Очистка кэша страниц (pagecache) + уплотнение памяти
  medium, 2, средняя - Очистка кэша страниц, каталогов и inode + уплотнение памяти
  high, 3, высокая   - Полная очистка кэшей, уплотнение памяти и очистка SWAP (если безопасно)

Если запустить без параметров, скрипт выполнится в интерактивном режиме:
сначала предложит проверить и закрыть тяжелые приложения, а затем очистить кэши.
EOF
}

main() {
    check_root
    
    # Сохраняем исходное количество доступной памяти
    local initial_available
    initial_available=$(free -m | awk '/Mem:/ {print $7}')
    
    # Если аргументы переданы
    if [[ $# -gt 0 ]]; then
        case "$1" in
            -h|--help)
                usage
                exit 0
                ;;
            -a|--apps)
                show_mem_status
                check_and_kill_apps
                show_mem_status
                exit 0
                ;;
            -c|--clean)
                if [[ $# -lt 2 ]]; then
                    error "При использовании флага -c / --clean необходимо указать уровень очистки (low/medium/high или 1/2/3)."
                fi
                local lvl
                lvl=$(echo "$2" | tr '[:upper:]' '[:lower:]')
                show_mem_status
                clean_memory "$lvl"
                show_mem_status
                
                # Подсчет освобожденной памяти
                local final_available
                final_available=$(free -m | awk '/Mem:/ {print $7}')
                local freed=$((final_available - initial_available))
                if [[ $freed -gt 0 ]]; then
                    echo -e "${GREEN}${BOLD}Освобождено в процессе очистки: ${freed} MB RAM.${NC}\n"
                fi
                exit 0
                ;;
            *)
                # Если передан просто уровень очистки без флагов
                local lvl
                lvl=$(echo "$1" | tr '[:upper:]' '[:lower:]')
                show_mem_status
                clean_memory "$lvl"
                show_mem_status
                
                local final_available
                final_available=$(free -m | awk '/Mem:/ {print $7}')
                local freed=$((final_available - initial_available))
                if [[ $freed -gt 0 ]]; then
                    echo -e "${GREEN}${BOLD}Освобождено в процессе очистки: ${freed} MB RAM.${NC}\n"
                fi
                exit 0
                ;;
        esac
    fi
    
    # Интерактивный режим
    show_mem_status
    
    # 1. Проверяем приложения в памяти
    read -rp "Хотите проверить приложения в памяти и закрыть ресурсоемкие? [Y/n]: " check_apps_choice
    # По умолчанию Enter означает "Да"
    if [[ -z "$check_apps_choice" || "$check_apps_choice" =~ ^[YyДд]$ ]]; then
        check_and_kill_apps
        # Показываем обновленный статус памяти, если закрывали приложения
        show_mem_status
    fi
    
    # 2. Очищаем кэши памяти
    echo -e "${BOLD}Выберите уровень очистки системных кэшей:${NC}"
    echo -e "1) ${GREEN}Малая${NC}   (Очистить кэш страниц, снижает нагрузку на диск)"
    echo -e "2) ${YELLOW}Средняя${NC} (Очистить кэш страниц + кэш метаданных inode/dentries)"
    echo -e "3) ${RED}Высокая${NC} (Полная очистка кэшей + очистка свопа, если достаточно RAM)"
    echo -e "4) Выход"
    echo ""
    read -rp "Ваш выбор [1-4]: " choice
    
    case "$choice" in
        1)
            clean_memory "low"
            ;;
        2)
            clean_memory "medium"
            ;;
        3)
            clean_memory "high"
            ;;
        4|*)
            echo "Выход без очистки кэшей."
            exit 0
            ;;
    esac
    
    show_mem_status
    
    # Подсчет итоговой освобожденной памяти
    local final_available
    final_available=$(free -m | awk '/Mem:/ {print $7}')
    local freed=$((final_available - initial_available))
    if [[ $freed -gt 0 ]]; then
        echo -e "${GREEN}${BOLD}Отличные новости! Освобождено в сумме: ${freed} MB оперативной памяти.${NC}"
    else
        echo -e "${GREEN}${BOLD}Очистка завершена. Память оптимизирована.${NC}"
    fi
}

main "$@"
