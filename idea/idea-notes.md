# Aplikacja - Veriffica (MVP)

## Główny problem
Inspekcja używanego samochodu przed zakupem jest dla laika stresująca, chaotyczna i obarczona wysokim ryzykiem błędnej decyzji. Kupujący nie wie, na co patrzeć, które objawy są istotne, jak interpretować usterki, jakie dokumenty zweryfikować ani jak zapamiętać wszystkie obserwacje podczas wizyty u sprzedawcy. Veriffica upraszcza ten proces, oferując spersonalizowaną, interaktywną listę kontrolną dopasowaną do konkretnego egzemplarza, która prowadzi użytkownika krok po kroku i porządkuje odpowiedzi oraz obserwacje z inspekcji. Aplikacja jest narzędziem pomocniczym i nie zastępuje profesjonalnego przeglądu technicznego.

## Najmniejszy zestaw funkcjonalności
- Język angielski jako jedyny język interfejsu aplikacji
- Strona główna: Publiczna strona z opisem produktu (prowadzenie przez 5-częściową inspekcję) oraz akcjami logowania/rejestracji
- System kont: Rejestracja i logowanie przy użyciu adresu e-mail i hasła. Dostęp do danych wyłącznie dla właściciela konta. Możliwość wylogowania oraz trwałego (nieodwracalnego) usunięcia profilu i wszystkich danych po potwierdzeniu
- Dashboard użytkownika: Kafelkowy podgląd sesji (Draft vs Completed) z automatycznym nazewnictwem na podstawie pól `Make`/`Model` oraz opcjonalnie `Year of production`/`Registration number`. Limit maksymalnie 2 inspekcji na konto (niezależnie od statusu) z pop-upem informującym o wykorzystaniu limitu. Pusty stan z CTA do rozpoczęcia pierwszej inspekcji. Możliwość wznowienia pracy oraz nieodwracalnego usunięcia inspekcji (Hard Delete) zwalniającego slot
- Instrukcja startowa: Przy każdym rozpoczęciu nowej inspekcji pop-up z instrukcją (treść z `idea/veriffica-instruction.md`) z opcją `Don't show again`
- Strona sesji: Centralny ekran inspekcji widoczny po kliknięciu kafelka. Pokazuje nazwę sesji, przyciski prowadzące do Parts 1-5 (z możliwością samodzielnego wyboru kolejnego etapu), bieżący Total Score, wskaźnik ukończenia inspekcji oraz jeden globalny, edytowalny dokument notatek (limit 10000 znaków)
- Formularz konfiguracji (Part 1 - Info about the car): Forma z danymi pojazdu (m.in. Price, Make, Model, Year, Registration number, VIN, Mileage, Fuel type, Transmission, Drive, Color, Body type, No of doors, Address, Notes). Pola `Make`, `Model`, `Fuel type`, `Transmission`, `Drive`, `Body type` są obowiązkowe i na ich podstawie generowana jest spersonalizowana lista pytań. Ścisła walidacja (m.in. blokada konfiguracji Electric + Manual), normalizacja danych oraz odblokowanie Parts 2-5 dopiero po poprawnym zapisie wymaganych pól. Pełne reguły walidacji pole-po-polu, zasady normalizacji oraz gotowe angielskie komunikaty błędów opisuje `idea/veriffica-part-1-validation-rules.md`
- System pytań (Part 2 - At a standstill, Part 3 - Starting the engine, Part 4 - Test drive, Part 5 - Documents): Pełnoekranowe, przesuwane karty (jedno pytanie na ekran) z nawigacją poziomą i blokadą przejścia dalej bez udzielenia odpowiedzi (`Yes`/`No`/`Don't know`). Cofanie gestem lub przyciskiem `Back` bez utraty odpowiedzi. Po zakończeniu każdego Partu ekran przejściowy z przyciskiem `OK` wracającym na stronę sesji. Sugerowany wskaźnik postępu w formacie `obecne pytanie / liczba pytań w danym Part`
- Dynamiczny dobór pytań: Widoczność grup pytań w modelu addytywnym `Base + fuelType + transmission + drive + bodyType`, uzupełnionym o runtime flags dla wyjątków (`chargingPortEquipped`, `evBatteryDocsAvailable`, `turboEquipped`, `mechanicalCompressorEquipped`, `importedFromEU`). System danych oparty na stabilnych identyfikatorach grup, pytań i wyjaśnień, a nie na tekstach pytań. Warstwa danych jest rozdzielona na trzy części: `questionGroups` (widoczność i logika warunkowa, metadane `part`/`section`/`subsection`/`order`), `questions` (treść pytań linkowana przez `groupId`) oraz `explanations` (współdzielone treści edukacyjne linkowane przez `explanationRef`). Pole `order` rośnie co 10, aby umożliwić późniejsze wstawianie pytań bez renumeracji. Źródło checklisty MVP znajduje się w `idea/veriffica-questions-list/` (patrz nota niżej)
- Smart Pruning: Po zmianie pól wpływających na widoczność (`fuelType`, `transmission`, `drive`, `bodyType` lub aktywnej runtime flag) aplikacja ostrzega użytkownika, zachowuje nadal poprawne odpowiedzi, usuwa odpowiedzi osierocone i natychmiast przelicza postęp oraz Total Score
- Interfejs edukacyjny: Ikona `i` przy pytaniach posiadających powiązane wyjaśnienie, otwierająca edukacyjny pop-up z treścią ze słownika `explanations`
- Notatki kontekstowe: Ikona `Notes` na każdej karcie pytania, otwierająca pop-up do zapisania notatki (limit 500 znaków). Po zapisaniu notatka jest dopisywana do globalnego dokumentu notatek wraz z treścią pytania jako nagłówkiem
- Strona Summary: Strona podsumowująca inspekcję. Zawiera:
	1. Wykres dla każdego Partu oraz globalny wykres dla całej inspekcji, prezentujące wyłącznie rozkład odpowiedzi `Yes`/`No`/`Don't know` (bez pojedynczej oceny jakości auta; wszystkie pytania mają taką samą wagę)
	2. Total Score jako rozkład odpowiedzi `Yes`/`No`/`Don't know` dla całego procesu inspekcji
	3. Pełną listę pytań i odpowiedzi dla aktualnego zestawu pytań, edytowalną inline bez wracania do widoku kart (zmiana natychmiast aktualizuje wykresy, postęp i Total Score)
- Cykl życia inspekcji: Status `Completed` nadawany wyłącznie ręcznie, wyraźnym przyciskiem finalizacji na stronie Summary. Ukończona inspekcja domyślnie otwiera się w trybie zamkniętego raportu; powrót do edycji wymaga świadomej akcji i potwierdzenia, przywraca status `Draft` i wymaga ponownej ręcznej finalizacji
- Strona profilowa: Strona z podstawowymi informacjami o koncie użytkownika
- Strona z ustawieniami: Co najmniej kontrola rozmiaru czcionki i motywu (dark/light). Domyślny motyw podąża za ustawieniami systemowymi urządzenia do momentu ręcznego nadpisania
- Tryb Offline-First (PWA): Praca bez dostępu do internetu po wcześniejszym załadowaniu aplikacji. Lokalne przechowywanie danych domenowych na urządzeniu (Part 1, odpowiedzi, notatki kontekstowe, globalny dokument notatek, status, postęp, kolejka zmian). Zmiany offline trafiają do "Kolejki Zmian" i są automatycznie synchronizowane w tle po odzyskaniu połączenia. Strategia konfliktów: `Last Write Wins / Client Wins`. Utrata połączenia nie wylogowuje użytkownika ani nie przerywa inspekcji; sesja jest odnawiana po powrocie online bez utraty lokalnego stanu

> **Nota o liście pytań i instrukcji startowej**
> Źródłem prawdy dla checklisty MVP jest pakiet artefaktów znajdujacy sie w `idea/veriffica-questions-list/`:
> - `list-of-questions.md` — czytelna dla człowieka, źródłowa lista wszystkich pytań z podziałem na Parts 2-5, sekcje i bazowy model widoczności
> - `question-bank.json` — znormalizowana treść pytań (stabilne `id`, `groupId`, `part`, `section`, `subsection`, `label`, `order`, opcjonalne `explanationRef`) oraz słownik `explanations`
> - `question-mapping-config.json` — konfiguracja widoczności grup (`id`, `part`, `order`, `section`, `subsection`, `dependsOnFields`, `visibleWhen`, opcjonalne `requiresEquipmentFlag`)
> - `question-bank.schema.json` oraz `question-mapping-config.schema.json` — kontrakty walidacyjne struktury obu plików JSON (niezależne od tech-stacku)
>
> Treść instrukcji startowej pokazywanej przy rozpoczęciu nowej inspekcji znajduje się w `idea/veriffica-instruction.md`. Instrukcja musi jasno komunikować, że checklistę należy traktować jako narzędzie pomocnicze, które nie zastępuje profesjonalnego przeglądu technicznego.

## Co NIE wchodzi w zakres MVP
- Wybór innych języków interfejsu aplikacji
- System zdjęć: Robienie własnych zdjęć, uploadowanie ich lub galerie dla inspekcji
- Eksport i udostępnianie: Generowanie plików PDF oraz wysyłanie raportów linkiem do innych osób
- Weryfikacja zewnętrzna: Sprawdzanie historii pojazdu po numerze VIN
- Natywne aplikacje: Publikacja w App Store i Google Play (MVP działa wyłącznie jako PWA w przeglądarce)
- Logowanie społecznościowe (Google/Apple) — w MVP wyłącznie e-mail i hasło
- Porównywarka: Funkcja zestawiania dwóch lub więcej raportów obok siebie na jednym ekranie
- System "Deal-breakerów": Automatyczna dyskwalifikacja auta przy wykryciu krytycznej usterki bezpieczeństwa
- Wagi usterek i algorytm ważonego scoringu
- Rozbudowany monitoring błędów w pierwszej fazie MVP

## Kryteria sukcesu

### Główne metryki
- Inspection completion rate: co najmniej 75% rozpoczętych inspekcji kończy się statusem `Completed` nadanym ręcznie przez użytkownika (przejście przez wszystkie 5 części: Info, Standstill, Engine, Drive, Documents).
- Offline sync success rate: 100% operacji domenowych zapisanych do "Kolejki Zmian" synchronizuje się poprawnie po odzyskaniu połączenia.

### Metryki wspierające
- Part 1 unlock rate: odsetek inspekcji, w których użytkownik poprawnie kończy Part 1 i odblokowuje Parts 2-5.
- Summary reach rate: odsetek rozpoczętych inspekcji, które docierają do strony Summary.
- Draft abandonment rate: odsetek inspekcji pozostawionych w statusie `Draft` bez manualnej finalizacji.
- `Don't know` share: udział odpowiedzi `Don't know` na poziomie Partów i całej inspekcji jako wskaźnik trudności checklisty dla laików.
- Limit hit frequency: liczba prób utworzenia trzeciej inspekcji na konto jako sygnał zapotrzebowania na przyszły model płatny lub rozszerzony.
- Draft deletion frequency: liczba usuniętych draftów jako sygnał jakości przepływu i użyteczności produktu.
