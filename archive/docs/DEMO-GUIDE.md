# Demo Guide - MenuManager Review System

## Quick Setup

```bash
./start-services.sh
```

---

## POST Command (Copy/Paste This)

```bash
curl -X POST http://localhost:3000/simulate-email \
  -F "file=@samples/demo-messy-menu.docx" \
  -F "from=chef@test.com"
```

Just change the filename to test different scenarios.

---

## Sample Files

| Filename | What It Demonstrates |
|----------|---------------------|
| `demo-wrong-template.docx` | Rejected - no RSH template |
| `demo-messy-menu.docx` | Rejected - too many errors (>10) |
| `demo-bad-format.docx` | Rejected - wrong font/alignment |
| `demo-minor-issues.docx` | Passes - goes to AI review |
| `example_pairs/TT_DXB_Brief_Half board_07112025.docx` | Passes - perfect submission |

All files are in the `samples/` folder.

---

## Key Metrics

| Current (Manual) | With MenuManager |
|------------------|------------------|
| 30-45 min per menu | 5-10 min per menu |
| 2-3 back-and-forth rounds | Instant feedback |
| Inconsistent SOP | 100% SOP enforcement |

**ROI:** ~10 hours/month saved = $6,000/year

---

## Common Questions

**Q: What if AI makes a mistake?**
> Human reviews everything. AI does heavy lifting, human makes final call.

**Q: Why so many automatic rejections?**
> They're instant! Chef gets feedback in seconds, not hours.

**Q: Can chefs bypass checks?**
> No, but they shouldn't want to. Each check enforces SOP.

---

## Troubleshooting

**Services won't start:**
```bash
./stop-services.sh && ./start-services.sh
```

**Dashboard not loading:**
```bash
curl http://localhost:3005  # Check if running
```

**View logs:**
```bash
tail -f logs/parser.log
tail -f logs/inbound-email.log
```
