#!/usr/bin/env bash
# Thin Jira Cloud REST v3 client for the `jira` skill.
#
# Config (env wins, then <repo>/.env — gitignored):
#   JIRA_BASE_URL   e.g. https://halopowered.atlassian.net
#   JIRA_EMAIL      Atlassian account email
#   JIRA_API_TOKEN  https://id.atlassian.com/manage-profile/security/api-tokens
#   JIRA_PROJECT    default project key (optional; most commands accept -p KEY)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CONFIG_FILE="${JIRA_CONFIG_FILE:-$REPO_ROOT/.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  # Only fill vars the environment has not already set.
  while IFS='=' read -r k v; do
    k="${k//[[:space:]]/}"
    [[ "$k" == JIRA_* ]] || continue
    v="${v%\"}"; v="${v#\"}"
    if [[ -z "${!k:-}" ]]; then export "$k=$v"; fi
  done < "$CONFIG_FILE"
fi

die() { echo "jira: $*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || die "$1 is not set (env or $CONFIG_FILE)"; }

usage() {
  cat <<'EOF'
Usage: jira.sh <command> [args]

  setup <base-url> <email> <project-key>   write config (token read from stdin / JIRA_API_TOKEN)
  whoami                                   verify credentials
  project [-p KEY]                         project details, issue types, components
  search [-p KEY] [-n N] [JQL]             search issues (default: open issues in project)
  issue <KEY-123>                          issue details (summary, status, description, comments)
  statuses [-p KEY]                        statuses per issue type
  transitions <KEY-123>                    available transitions
  create [-p KEY] -t TYPE -s SUMMARY [-d DESC]   create issue          (write)
  comment <KEY-123> <TEXT>                 add a comment               (write)
  transition <KEY-123> <TRANSITION-NAME|ID>  move issue                (write)
  raw <METHOD> <PATH> [JSON]               any REST call, PATH like /rest/api/3/...
EOF
}

api() {
  local method="$1" path="$2" body="${3:-}"
  need JIRA_BASE_URL; need JIRA_EMAIL; need JIRA_API_TOKEN
  local args=(-sS -w '\n%{http_code}' -X "$method" -u "$JIRA_EMAIL:$JIRA_API_TOKEN"
    -H 'Accept: application/json')
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  local out code
  out="$(curl "${args[@]}" "${JIRA_BASE_URL%/}$path")"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  if [[ "$code" -ge 400 ]]; then
    echo "$out" | jq -r '(.errorMessages // []) + ((.errors // {}) | to_entries | map("\(.key): \(.value)")) | join("\n")' 2>/dev/null >&2 || echo "$out" >&2
    die "HTTP $code on $method $path"
  fi
  printf '%s' "$out"
}

# Plain text -> Atlassian Document Format (one paragraph per line).
adf() {
  jq -Rn '{type:"doc",version:1,content:[inputs|select(length>0)|{type:"paragraph",content:[{type:"text",text:.}]}]}' <<<"$1"
}

# ADF -> plain text, good enough for reading descriptions/comments.
ADF_TEXT='def t: if type=="array" then map(t) | join("") elif type!="object" then "" elif .type=="text" then .text elif .type=="hardBreak" then "\n" else ((.content // []) | map(t) | join("")) + (if (.type | IN("paragraph","heading","listItem","codeBlock","blockquote")) then "\n" else "" end) end;'

project_key() { local p="${PROJECT:-${JIRA_PROJECT:-}}"; [[ -n "$p" ]] || die "no project: pass -p KEY or set JIRA_PROJECT"; echo "$p"; }

cmd="${1:-}"; shift || true
PROJECT=""; N=25; TYPE=""; SUMMARY=""; DESC=""
parse_opts() {
  while getopts ":p:n:t:s:d:" o; do
    case "$o" in
      p) PROJECT="$OPTARG";; n) N="$OPTARG";; t) TYPE="$OPTARG";;
      s) SUMMARY="$OPTARG";; d) DESC="$OPTARG";; *) die "bad option -$OPTARG";;
    esac
  done
}

case "$cmd" in
  setup)
    [[ $# -ge 3 ]] || die "usage: setup <base-url> <email> <project-key>"
    token="${JIRA_API_TOKEN:-}"
    [[ -z "$token" ]] && { read -r -s -p "Jira API token: " token; echo >&2; }
    [[ -n "$token" ]] || die "no token given"
    umask 077; touch "$CONFIG_FILE"
    # Upsert only the JIRA_* keys so other vars in the file survive.
    tmp="$(mktemp)"
    grep -vE '^(JIRA_BASE_URL|JIRA_EMAIL|JIRA_API_TOKEN|JIRA_PROJECT)=' "$CONFIG_FILE" > "$tmp" || true
    printf 'JIRA_BASE_URL=%s\nJIRA_EMAIL=%s\nJIRA_API_TOKEN=%s\nJIRA_PROJECT=%s\n' \
      "${1%/}" "$2" "$token" "$3" >> "$tmp"
    mv "$tmp" "$CONFIG_FILE"; chmod 600 "$CONFIG_FILE"
    echo "wrote $CONFIG_FILE"
    JIRA_BASE_URL="${1%/}" JIRA_EMAIL="$2" JIRA_API_TOKEN="$token" "$0" whoami
    ;;
  whoami)
    api GET /rest/api/3/myself | jq '{accountId, displayName, emailAddress, timeZone}'
    ;;
  project)
    parse_opts "$@"; key="$(project_key)"
    api GET "/rest/api/3/project/$key?expand=description,lead,issueTypes" | jq '{
      key, name, id, projectTypeKey, lead: .lead.displayName, description,
      issueTypes: [.issueTypes[] | {name, subtask}],
      components: [.components[]?.name]}'
    ;;
  search)
    parse_opts "$@"; shift $((OPTIND - 1))
    jql="${*:-}"
    [[ -z "$jql" ]] && jql="project = $(project_key) AND statusCategory != Done ORDER BY updated DESC"
    body="$(jq -n --arg jql "$jql" --argjson n "$N" \
      '{jql:$jql, maxResults:$n, fields:["summary","status","assignee","issuetype","priority","updated"]}')"
    api POST /rest/api/3/search/jql "$body" | jq -r '
      .issues[] | [.key, .fields.issuetype.name, .fields.status.name,
        (.fields.priority.name // "-"), (.fields.assignee.displayName // "unassigned"),
        .fields.updated[0:10], .fields.summary] | @tsv'
    ;;
  issue)
    [[ $# -ge 1 ]] || die "usage: issue <KEY-123>"
    api GET "/rest/api/3/issue/$1?fields=summary,status,assignee,reporter,issuetype,priority,labels,components,parent,created,updated,description,comment" |
      jq "$ADF_TEXT"' {key, url: ("'"${JIRA_BASE_URL%/}"'/browse/" + .key),
        type: .fields.issuetype.name, status: .fields.status.name, priority: .fields.priority.name,
        assignee: .fields.assignee.displayName, reporter: .fields.reporter.displayName,
        parent: .fields.parent.key, labels: .fields.labels, components: [.fields.components[]?.name],
        created: .fields.created, updated: .fields.updated, summary: .fields.summary,
        description: (.fields.description | t),
        comments: [.fields.comment.comments[] | {author: .author.displayName, created, body: (.body | t)}]}'
    ;;
  statuses)
    parse_opts "$@"
    api GET "/rest/api/3/project/$(project_key)/statuses" |
      jq -r '.[] | "\(.name): \([.statuses[].name] | join(", "))"'
    ;;
  transitions)
    [[ $# -ge 1 ]] || die "usage: transitions <KEY-123>"
    api GET "/rest/api/3/issue/$1/transitions" | jq -r '.transitions[] | "\(.id)\t\(.name)\t-> \(.to.name)"'
    ;;
  create)
    parse_opts "$@"
    [[ -n "$TYPE" && -n "$SUMMARY" ]] || die "usage: create [-p KEY] -t TYPE -s SUMMARY [-d DESC]"
    body="$(jq -n --arg p "$(project_key)" --arg t "$TYPE" --arg s "$SUMMARY" \
      --argjson d "$( [[ -n "$DESC" ]] && adf "$DESC" || echo null )" \
      '{fields: ({project:{key:$p}, issuetype:{name:$t}, summary:$s} + (if $d then {description:$d} else {} end))}')"
    api POST /rest/api/3/issue "$body" | jq -r '"created \(.key) '"${JIRA_BASE_URL%/}"'/browse/\(.key)"'
    ;;
  comment)
    [[ $# -ge 2 ]] || die "usage: comment <KEY-123> <TEXT>"
    api POST "/rest/api/3/issue/$1/comment" "$(jq -n --argjson b "$(adf "$2")" '{body:$b}')" |
      jq -r '"comment \(.id) added"'
    ;;
  transition)
    [[ $# -ge 2 ]] || die "usage: transition <KEY-123> <TRANSITION-NAME|ID>"
    id="$(api GET "/rest/api/3/issue/$1/transitions" |
      jq -r --arg x "$2" '.transitions[] | select(.id==$x or (.name|ascii_downcase)==($x|ascii_downcase)) | .id' | head -1)"
    [[ -n "$id" ]] || die "no transition '$2' on $1 (see: jira.sh transitions $1)"
    api POST "/rest/api/3/issue/$1/transitions" "$(jq -n --arg id "$id" '{transition:{id:$id}}')" >/dev/null
    echo "$1 transitioned via $id"
    ;;
  raw)
    [[ $# -ge 2 ]] || die "usage: raw <METHOD> <PATH> [JSON]"
    api "$1" "$2" "${3:-}" | jq .
    ;;
  ""|-h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
