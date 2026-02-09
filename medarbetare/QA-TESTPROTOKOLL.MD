QA-TESTPROTOKOLL (generellt) — Jämför kodversioner och välj bäst

Syfte:
Gör en enkel men tydlig jämförelse av kod (1–3 versioner) och avgör vilken som är bäst totalt, samt vad varje kod är bäst på.

Input jag skickar dig:

AO/krav (om finns)

Kodfil(er) (hel fil) eller repo+commit

Ev. kort beskrivning av vad koden ska göra

Output jag vill ha från dig (måste följas):

PASS/FAIL (om AO finns: mot KRAV + DoD)

Varför (max 5 rader)

Testtabell: 6 kriterier (betyg + kort kommentar)

Buggar: P0 / P1 / P2

Risker

FÖRSLAG (max 3–5) (bara stabilitet/säkerhet/tydlighet – inga nya features)

Testfall (5–10 konkreta steg)

Patch-plan utan kod (exakt var i filen, vad som ska ändras)

1) Bedömningsmodell (6 viktigaste saker en kod ska ha)

Betygsätt varje kriterium per kodversion:

3 = Stark

2 = Okej

1 = Svag

0 = Risk

Kriterier:

Stabilitet – Klarar tomt/felaktigt läge utan att krascha eller bete sig konstigt.

Säkerhet – Tål oväntad input/data utan farliga effekter.

Tydlighet – Lätt att läsa och förstå (för någon annan som tar över).

Pålitlighet över tid – Fortsätter ge rimliga resultat när data ändras över tid.

Prestanda – Undviker onödigt arbete, skalar bättre när data växer.

Förändringsbarhet – Lätt att bygga vidare utan att skapa nya risker.

2) Testtabell (ska alltid ingå)

Skapa en tabell som denna:

Kriterium	Kod A	Kod B	Kod C	Vinnare	Kort kommentar
1) Stabilitet					
2) Säkerhet					
3) Tydlighet					
4) Pålitlighet över tid					
5) Prestanda					
6) Förändringsbarhet					

Totalpoäng (max 18 per kod): summera och rangordna.

3) Viktiga testregler (för att få rättvis jämförelse)

Jämför bara det som finns i koden (inga antaganden).

Om AO/krav finns: testa mot dem först.

Prioritera alltid: stabilitet och säkerhet före “snygghet”.

Om något är oklart: markera som Risk (inte som “troligen ok”).

Inga refaktor-krav om det inte behövs – refaktor får bara vara FÖRSLAG.

4) “Superkod”-analys (om det finns flera versioner)

Efter tabellen: skriv kort om detta:

Vilken kod ska vara bas? (oftast den med bäst stabilitet/säkerhet)

Kan något tas från en annan kod för att förbättra?

Bara om det inte försämrar stabilitet/säkerhet

Skriv max 3 punkter, som “kan flyttas in”, och varför

Inget blandande fritt – det ska vara kontrollerat

5) Patch-plan utan kod (måste vara konkret)

För varje P0/P1: skriv:

Var i filen: (sektion/block/funktionsnamn)

Vad som ska ändras: (i klartext)

Varför: (kopplat till risk/bugg/krav)

Hur man testar: (1–2 steg)

6) Pass-regel (om AO finns)

PASS endast om:

Alla KRAV = PASS

0 P0 och 0 P1
