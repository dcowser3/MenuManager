# Creating Demo Sample Files

To demonstrate all validation scenarios, you need 5 test files. Here's how to create them:

---

## ✅ Sample 1: Perfect Submission (ALREADY EXISTS)

**File:** `example_pairs/TT_DXB_Brief_Half board_07112025.docx`

This file already exists and demonstrates the happy path.

---

## ❌ Sample 2: Wrong Template

**Filename:** `demo-wrong-template.docx`

**How to create:**
1. Open Microsoft Word
2. Create a **blank new document**
3. Add some menu content (without using template):
   ```
   DINNER MENU
   
   Appetizers
   Guacamole - Fresh avocado, lime, cilantro - $12
   Tacos - Corn tortillas, salsa - $15
   
   Main Courses
   Enchiladas - Cheese, red sauce - $18
   Burrito - Beans, rice, cheese - $16
   ```
4. Save as `samples/demo-wrong-template.docx`

**What this demonstrates:**
- Template validation catches missing RSH template
- Chef gets email explaining which template to use

---

## ⚠️ Sample 3: Too Many Errors (Messy Menu)

**Filename:** `demo-messy-menu.docx`

**How to create:**
1. **Start with the official template:**
   - Open `RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
2. **Fill out page 1 form fields** (any values)
3. **On page 2, add menu with INTENTIONAL ERRORS:**
   ```
   DINNER MENU
   
   STARTERS
   
   Guacamol - Fresh avacado-lime-cilantro - $12
   (errors: misspelling, wrong separators, ALL CAPS)
   
   Queso Fundido - Melted cheese-chorizo-jalapeno - $14
   (errors: missing diacritic, wrong separators)
   
   Tacos al Pastor - Pork-pineapple-onion-cilantro - $16
   (errors: wrong separators)
   
   ENTREES
   
   Enchiladas Verdes - Chicken enchiladas-green salsa-crema $22
   (errors: wrong separators, inconsistent price format)
   
   Carne Asada - Grilled steak / rice-beans-tortillas | $28
   (errors: mixed separators)
   
   Chile Relleno - Poblano pepper, queso fresco, rice, beans - 24
   (errors: missing $ on price)
   
   Mole Poblano - Chicken-traditional mole sauce-sesame $26
   (errors: wrong separators)
   
   DESSERTS
   
   Flan - Traditional creme brulee style - $8
   (errors: missing diacritics on crème brûlée)
   
   Churros - Cinnamon sugar, chocolate $7
   (errors: missing dipping sauce separator)
   ```
4. **Keep Calibri, 12pt, centered** (format is OK)
5. Save as `samples/demo-messy-menu.docx`

**What this demonstrates:**
- Pre-check catches 10+ errors
- System tells chef to run QA prompt first
- Shows enforcement of SOP process

---

## ⚠️ Sample 4: Format Issues

**Filename:** `demo-bad-format.docx`

**How to create:**
1. **Start with the official template:**
   - Open `RSH_DESIGN BRIEF_FOOD_Menu_Template .docx`
2. **Fill out page 1 form fields** (any values)
3. **On page 2, add CLEAN menu content:**
   ```
   DINNER MENU
   
   STARTERS
   
   Guacamole - Fresh avocado / lime / cilantro - $12
   Queso Fundido - Melted cheese / chorizo / jalapeño - $14
   Tacos al Pastor - Pork / pineapple / onion / cilantro - $16
   
   ENTRÉES
   
   Enchiladas Verdes - Chicken / green salsa / crema - $22
   Carne Asada - Grilled steak / rice / beans / tortillas - $28
   Chile Relleno - Poblano pepper / queso fresco / rice / beans - $24
   
   DESSERTS
   
   Flan - Traditional caramel custard - $8
   Churros - Cinnamon sugar / chocolate dipping sauce - $7
   ```
4. **NOW: Change formatting on page 2 ONLY:**
   - Select all text on page 2
   - Change font to **Arial** (not Calibri)
   - Change alignment to **Left** (not Center)
   - Change size to **11pt** (not 12pt)
5. Save as `samples/demo-bad-format.docx`

**What this demonstrates:**
- Format lint catches wrong font/alignment/size
- Shows SOP formatting enforcement
- Chef gets specific fix instructions

---

## 📝 Sample 5: Minor Issues (AI Review Path)

**Filename:** `demo-minor-issues.docx`

**How to create:**
1. **Start with the official template**
2. **Fill out page 1 form fields**
3. **On page 2, add MOSTLY clean menu with 1-2 tiny errors:**
   ```
   DINNER MENU
   
   STARTERS
   
   Guacamole - Fresh avocado / lime / cilantro - $12
   Queso Fundido - Melted cheese / chorizo / jalapeño - $14
   Tacos al Pastor - Pork / pineapple / onion / cilatro - $16
                                                    ^ (typo: cilatro → cilantro)
   
   ENTRÉES
   
   Enchiladas Verdes - Chicken / green salsa / crema - $22
   Carne Asada - Grilled steak / rice / beans / tortillas - $28
   Chile Relleno - Poblano pepper / queso fresco / rice / beans - $24
   Mole Poblano - Chicken / traditional mole sauce / sesame seeds - $26
   
   DESSERTS
   
   Flan - Traditional caramel custard - $8
   Tres Leches Cake - Vanilla cake / three milk mixture / whipped crème - $9
                                                                   ^ (typo: crème → cream)
   ```
4. **Keep proper formatting** (Calibri, 12pt, centered)
5. Save as `samples/demo-minor-issues.docx`

**What this demonstrates:**
- Passes all validation gates
- AI catches subtle errors (typos)
- Shows AI value in finding small mistakes
- Human reviews AI suggestions
- This is the "happy path" where AI shines

---

## 📂 Final File Structure

After creating all samples, you should have:

```
samples/
├── RSH_DESIGN BRIEF_FOOD_Menu_Template .docx (template)
├── RSH Design Brief Beverage Template.docx (template)
├── example_pairs/
│   └── TT_DXB_Brief_Half board_07112025.docx (✅ perfect)
├── demo-wrong-template.docx (❌ no template)
├── demo-messy-menu.docx (⚠️ many errors)
├── demo-bad-format.docx (⚠️ wrong format)
└── demo-minor-issues.docx (📝 AI review)
```

---

## 🧪 Testing Your Samples

After creating, test each one:

```bash
# Test wrong template
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-wrong-template.docx" \
  -F "from=test@example.com"

# Test messy menu
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-messy-menu.docx" \
  -F "from=test@example.com"

# Test bad format
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-bad-format.docx" \
  -F "from=test@example.com"

# Test minor issues
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-minor-issues.docx" \
  -F "from=test@example.com"
```

Check logs to verify correct rejection/acceptance:
```bash
tail -f logs/parser.log
tail -f logs/inbound-email.log
```

---

## ✅ Quick Creation Checklist

- [ ] Create demo-wrong-template.docx (blank doc, no template)
- [ ] Create demo-messy-menu.docx (template + 15+ errors)
- [ ] Create demo-bad-format.docx (template + wrong formatting)
- [ ] Create demo-minor-issues.docx (template + 1-2 typos)
- [ ] Test each sample file
- [ ] Verify correct email replies are generated

---

**Time to create all samples: ~15 minutes**

Once created, you're ready to run the full demo with `./run-demo.sh`!
