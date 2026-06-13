#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  PokeValue Scanner — Pokémon TCG scanner mobile app with AI vision, market pricing,
  condition assessment, freemium paywall. Premium dark theme + neon yellow accents.
  Bilingual PT/EN. Latest user request: finalize i18n translations on remaining
  screens AND add a Share Card feature (capture the graded card as a polished image
  and open native share sheet so collectors can share their grades on Instagram/
  WhatsApp/Discord).

frontend:
  - task: "Complete i18n translations on condition.tsx (Centering / Corners / Edges / Surface aspects, header title, banner labels, CTA)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/condition.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Replaced static EN ASPECTS array with ASPECT_KEYS that read from t.condition.{key} / t.condition.{key}Sub. Header now uses t.condition.title, banner uses t.condition.detectedCard/unknownCard, CTA uses t.condition.calculate."

  - task: "Add I18nProvider to root _layout.tsx (was missing import, app crashed at boot)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Added missing `import { I18nProvider } from '@/src/i18n-context';` to fix `ReferenceError: I18nProvider is not defined` at RootLayout."

  - task: "Translate remaining strings in card-detail.tsx (Poor / Mint labels, No live market message) and switch to useI18n() to expose locale"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/card-detail.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Switched from useT() to useI18n() to access locale for ShareCard. Replaced hardcoded Poor/Mint with t.detail.poor / t.detail.mint and noLiveData with t.detail.noLiveData."

  - task: "Share Card feature (off-screen ViewShot + react-native-view-shot + expo-sharing)"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/share-card.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Added a new <ShareCard /> composer that renders an off-screen branded
            social card (card art + grade + value retained + estimated price +
            POKEVALUE SCANNER footer). On the Card Detail screen, a new share-social
            icon button in the hero top bar snapshots the composer via captureRef and
            opens native share sheet via expo-sharing.shareAsync. Falls back gracefully
            on web (sharing unavailable banner). Translations under t.share.* in PT/EN.

backend:
  - task: "No backend changes in this session"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Untouched. Backend continues to serve scan/analyze, scan/count, portfolio, price endpoints."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Complete i18n translations on condition.tsx (Centering / Corners / Edges / Surface aspects, header title, banner labels, CTA)"
    - "Add I18nProvider to root _layout.tsx (was missing import, app crashed at boot)"
    - "Share Card feature (off-screen ViewShot + react-native-view-shot + expo-sharing)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: |
        Implemented two changes:
        1) Finished i18n second pass: condition.tsx is fully bilingual now (all aspect titles/subtitles, header, banner, CTA pulled from t.condition.*). Card-detail.tsx Poor/Mint labels and noLiveData also localized. Fixed a critical regression where I18nProvider was used in _layout.tsx without being imported (app crashed at boot). Now app boots and login screen renders cleanly.
        2) New "Share Card" feature: a polished social-ready card composition rendered off-screen via react-native-view-shot, then snapshotted and shared through expo-sharing. New share-social button lives next to remove/back on card-detail hero. Caption builder uses t.share.captionWithApp(name, price).
        Please verify:
          - Boot + login (no I18nProvider error).
          - Toggle PT/EN on the language flag — all 6 condition aspects, banner, CTA, Poor/Mint labels switch.
          - On a saved portfolio card, open Card Detail, confirm the share button appears in the top right next to the trash. (Sharing won't open a real share sheet in web preview — expect the in-app "sharing unavailable on this device" banner. Native testing requires development build.)
