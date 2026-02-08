# Checkvist #cc Automation

Automatisk övervakning av Checkvist-listor för #cc tags. När en task är taggad med #cc, svarar Claude automatiskt med en kommentar och ändrar taggen till #cc-svar.

## Setup

### 1. GitHub Repository

Pusha detta projekt till GitHub:

```bash
git add .
git commit -m "Add Checkvist #cc automation"
git remote add origin https://github.com/DIN-ANVÄNDARE/checkvist-mcp.git
git push -u origin main
```

### 2. GitHub Secrets

Gå till ditt GitHub repo → Settings → Secrets and variables → Actions → New repository secret

Lägg till dessa secrets:

- `CHECKVIST_USERNAME` - Din Checkvist email
- `CHECKVIST_API_KEY` - Din Checkvist API-nyckel (från https://checkvist.com/auth/profile)
- `ANTHROPIC_API_KEY` - Din Anthropic API-nyckel (från https://console.anthropic.com/)

### 3. Aktivera GitHub Actions

GitHub Actions kommer automatiskt att köras var 5:e minut efter att du pushat koden.

Du kan också köra manuellt:
- Gå till Actions tab
- Välj "Checkvist CC Monitor"
- Klicka "Run workflow"

## Lokal testning

```bash
# Sätt environment variables i .env:
CHECKVIST_USERNAME=din@email.com
CHECKVIST_API_KEY=din_api_nyckel
ANTHROPIC_API_KEY=din_anthropic_nyckel

# Kör scriptet:
node scripts/check-cc-tags.js
```

## Hur det fungerar

1. Scriptet listar alla dina Checkvist-listor
2. För varje lista, hittar tasks taggade med #cc
3. Skickar task-innehållet till Claude API
4. Postar Claudes svar som kommentar på tasken
5. Ändrar taggen från #cc till #cc-svar

## Användning

1. Tagga en task med #cc i någon av dina Checkvist-listor
2. Vänta upp till 5 minuter
3. Claude svarar med en kommentar som börjar med "Claude: "
4. Taggen ändras automatiskt till #cc-svar

**Fungerar på alla plattformar:**
- ✅ Checkvist webb
- ✅ Checkvist mobil (iOS/Android)
- ✅ Checkvist desktop

Eftersom allt körs via API och uppdaterar Checkvist-servern, synkas ändringarna automatiskt till alla dina enheter.
