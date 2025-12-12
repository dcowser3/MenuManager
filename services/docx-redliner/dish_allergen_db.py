"""
Dish Database
==============

Comprehensive database for storing dish information learned from training data.

The AI reviewer can query this database to:
1. Look up the CORRECT DESCRIPTION for any known dish
2. Look up known allergens for dishes
3. Detect when a dish description doesn't match the approved version
4. Learn from human corrections over time
5. Store restaurant-specific variations

Each dish entry includes:
- dish_name: The name of the dish (e.g., "Enfrijochiladas")
- full_description: The complete APPROVED description (e.g., "black bean sauce, scrambled eggs, bacon, pico de gallo, guajillo crema, cotija cheese")
- allergens: List of allergen codes (D, G, S, etc.)
- price: Price if known
- restaurant: Restaurant identifier
- ingredients: Parsed list of ingredients
- source: How this was learned (training, manual, correction)
- confidence: 0-1 score (increases with more corrections)
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import re

# Allergen code definitions (from RSH SOP)
ALLERGEN_CODES = {
    'D': 'Dairy',
    'G': 'Gluten',
    'N': 'Nuts',
    'S': 'Shellfish',
    'V': 'Vegetarian',
    'VG': 'Vegan',
}

# Common ingredient → allergen mappings for AI inference
INGREDIENT_ALLERGENS = {
    # Dairy
    'milk': 'D', 'cheese': 'D', 'cream': 'D', 'butter': 'D', 'yogurt': 'D',
    'crema': 'D', 'queso': 'D', 'mozzarella': 'D', 'parmesan': 'D', 'ricotta': 'D',
    'burrata': 'D', 'mascarpone': 'D', 'béchamel': 'D', 'alfredo': 'D',
    
    # Nuts
    'almond': 'N', 'peanut': 'N', 'walnut': 'N', 'pistachio': 'N', 'cashew': 'N',
    'hazelnut': 'N', 'pecan': 'N', 'pine nut': 'N', 'macadamia': 'N',
    
    # Gluten
    'bread': 'G', 'flour': 'G', 'wheat': 'G', 'panko': 'G', 'crumb': 'G',
    'pasta': 'G', 'noodle': 'G', 'tortilla': 'G', 'croissant': 'G', 'brioche': 'G',
    
    # Fish
    'salmon': 'F', 'tuna': 'F', 'cod': 'F', 'halibut': 'F', 'sea bass': 'F',
    'snapper': 'F', 'trout': 'F', 'anchovy': 'F', 'mackerel': 'F',
    
    # Crustaceans
    'shrimp': 'C', 'prawn': 'C', 'crab': 'C', 'lobster': 'C', 'crawfish': 'C',
    
    # Eggs
    'egg': 'E', 'aioli': 'E', 'mayonnaise': 'E', 'hollandaise': 'E', 'meringue': 'E',
    
    # Sesame
    'sesame': 'SE', 'tahini': 'SE',
    
    # Soy
    'soy': 'SY', 'tofu': 'SY', 'edamame': 'SY', 'miso': 'SY', 'tempeh': 'SY',
    
    # Mustard
    'mustard': 'M', 'dijon': 'M',
}

# Database path
DB_PATH = Path(__file__).parent.parent.parent / 'data' / 'dish-allergens.json'


def _create_empty_database() -> Dict:
    """Create an empty database structure."""
    return {
        'version': '1.0.0',
        'last_updated': datetime.now().isoformat(),
        'entries': [],
        'statistics': {
            'total_dishes': 0,
            'by_restaurant': {},
            'by_source': {},
        }
    }


def load_database() -> Dict:
    """Load the dish allergen database."""
    try:
        with open(DB_PATH, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        db = _create_empty_database()
        save_database(db)
        return db


def save_database(db: Dict) -> None:
    """Save the database to disk."""
    # Ensure directory exists
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    # Update statistics
    db['statistics']['total_dishes'] = len(db['entries'])
    db['statistics']['by_restaurant'] = {}
    db['statistics']['by_source'] = {}
    
    for entry in db['entries']:
        restaurant = entry.get('restaurant', 'unknown')
        source = entry.get('source', 'unknown')
        
        db['statistics']['by_restaurant'][restaurant] = \
            db['statistics']['by_restaurant'].get(restaurant, 0) + 1
        db['statistics']['by_source'][source] = \
            db['statistics']['by_source'].get(source, 0) + 1
    
    db['last_updated'] = datetime.now().isoformat()
    
    with open(DB_PATH, 'w') as f:
        json.dump(db, f, indent=2)


def normalize_dish_name(name: str) -> str:
    """Normalize a dish name for consistent lookups."""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', name.lower().strip()))


def extract_restaurant(filename: str) -> str:
    """Extract restaurant identifier from filename."""
    name = Path(filename).stem
    
    # Try to extract restaurant name
    patterns = [
        r'^([\w\s\']+?)[\s_-]*(menu|revision|brief|submission)',
        r'^([\w\s\']+?)[\s_-]*\d',
        r'^([\w\s\']+)',
    ]
    
    for pattern in patterns:
        match = re.match(pattern, name, re.IGNORECASE)
        if match:
            return re.sub(r'_+', '_', re.sub(r'[^\w]', '_', match.group(1).lower().strip()))
    
    return 'unknown'


def parse_allergen_codes(codes_str: str) -> List[str]:
    """Parse allergen codes from a string like 'd,n,v'."""
    codes = []
    for code in codes_str.upper().replace(' ', '').split(','):
        code = code.strip().rstrip('*')
        if code in ALLERGEN_CODES:
            codes.append(code)
    return sorted(set(codes))


def lookup_dish(dish_name: str, restaurant: Optional[str] = None) -> Optional[Dict]:
    """Look up allergens for a dish."""
    db = load_database()
    normalized = normalize_dish_name(dish_name)
    
    # First try exact match with restaurant
    if restaurant:
        for entry in db['entries']:
            if entry['dish_name_normalized'] == normalized and entry['restaurant'] == restaurant:
                return entry
    
    # Then try any restaurant
    for entry in db['entries']:
        if entry['dish_name_normalized'] == normalized:
            return entry
    
    return None


def extract_menu_date(filename: str) -> Optional[str]:
    """
    Extract menu date from filename.
    
    Common patterns:
    - "menu 1.NOV.2025.docx" → "2025-11-01"
    - "menu_07112025.docx" → "2025-11-07"
    - "menu 11.18.25.docx" → "2025-11-18"
    - "menu_2025-11-18.docx" → "2025-11-18"
    - "menu nov 2025.docx" → "2025-11-01"
    - "casa chi crw menu nov 2025.docx" → "2025-11-01"
    """
    name = Path(filename).stem.lower()
    
    month_map = {
        'jan': '01', 'january': '01',
        'feb': '02', 'february': '02',
        'mar': '03', 'march': '03',
        'apr': '04', 'april': '04',
        'may': '05',
        'jun': '06', 'june': '06',
        'jul': '07', 'july': '07',
        'aug': '08', 'august': '08',
        'sep': '09', 'september': '09',
        'oct': '10', 'october': '10',
        'nov': '11', 'november': '11',
        'dec': '12', 'december': '12'
    }
    
    # Pattern 1: D.MON.YYYY (e.g., 1.NOV.2025 or 1 NOV 2025)
    match = re.search(r'(\d{1,2})[\.\s]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\.\s]?(\d{4})', name)
    if match:
        day_int = int(match.group(1))
        if 1 <= day_int <= 31:
            day = match.group(1).zfill(2)
            month = month_map.get(match.group(2)[:3], '01')
            year = match.group(3)
            return f"{year}-{month}-{day}"
    
    # Pattern 2: MON YYYY or MON.YYYY (e.g., "nov 2025" or "november 2025")
    match = re.search(r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\.\s]+(\d{4})', name)
    if match:
        month = month_map.get(match.group(1)[:3], '01')
        year = match.group(2)
        return f"{year}-{month}-01"  # Default to 1st of month
    
    # Pattern 3: DDMMYYYY (e.g., 07112025)
    match = re.search(r'(\d{2})(\d{2})(\d{4})', name)
    if match:
        day, month, year = match.groups()
        if 1 <= int(month) <= 12 and 1 <= int(day) <= 31:
            return f"{year}-{month}-{day}"
    
    # Pattern 4: MM.DD.YY (e.g., 11.18.25)
    match = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)', name)
    if match:
        month = match.group(1).zfill(2)
        day = match.group(2).zfill(2)
        year = '20' + match.group(3)
        if 1 <= int(month) <= 12 and 1 <= int(day) <= 31:
            return f"{year}-{month}-{day}"
    
    # Pattern 5: YYYY-MM-DD (standard ISO)
    match = re.search(r'(\d{4})-(\d{2})-(\d{2})', name)
    if match:
        year, month, day = match.groups()
        if 1 <= int(month) <= 12 and 1 <= int(day) <= 31:
            return match.group(0)
    
    return None


def extract_menu_type(filename: str) -> Optional[str]:
    """
    Extract menu type from filename.
    
    Examples:
    - "dlena brunch menu.docx" → "brunch"
    - "dinner menu.docx" → "dinner"
    - "cocktails.docx" → "cocktails"
    """
    name = Path(filename).stem.lower()
    
    menu_types = [
        'brunch', 'breakfast', 'lunch', 'dinner', 'supper',
        'cocktails', 'cocktail', 'drinks', 'beverage', 'beverages',
        'dessert', 'desserts', 'appetizer', 'appetizers',
        'happy hour', 'late night', 'tasting', 'prix fixe'
    ]
    
    for menu_type in menu_types:
        if menu_type in name:
            return menu_type
    
    return None


def upsert_dish(
    dish_name: str,
    allergens: List[str] = None,
    restaurant: str = 'global',
    ingredients: Optional[List[str]] = None,
    description: Optional[str] = None,
    full_line: Optional[str] = None,
    price: Optional[str] = None,
    source: str = 'training',
    confidence: float = 0.5,
    notes: Optional[str] = None,
    menu_date: Optional[str] = None,
    menu_type: Optional[str] = None
) -> Dict:
    """
    Add or update a dish in the database.
    
    Args:
        dish_name: Name of the dish (e.g., "Enfrijochiladas")
        allergens: List of allergen codes (e.g., ["D", "G"])
        restaurant: Restaurant identifier
        ingredients: Parsed list of ingredients
        description: Description part (ingredients after the dish name)
        full_line: The COMPLETE approved line (dish name + description + allergens + price)
        price: Price if known
        source: How this was learned
        confidence: Confidence score
        notes: Additional notes
        menu_date: Date of the menu (YYYY-MM-DD)
        menu_type: Type of menu (brunch, dinner, etc.)
    """
    db = load_database()
    
    normalized = normalize_dish_name(dish_name)
    allergens = allergens or []
    
    # Check if entry exists
    entry = None
    for e in db['entries']:
        if e['dish_name_normalized'] == normalized and e['restaurant'] == restaurant:
            entry = e
            break
    
    if entry:
        # Update existing entry - but only if new info has higher confidence
        entry['updated_at'] = datetime.now().isoformat()
        entry['correction_count'] = entry.get('correction_count', 0) + 1
        entry['confidence'] = min(1.0, entry.get('confidence', 0.5) + 0.1)
        
        # Update allergens if provided
        if allergens:
            entry['allergens'] = sorted(set(allergens))
        
        # Update full_line if provided (the approved description)
        if full_line:
            entry['full_line'] = full_line
        
        # Update price if provided
        if price:
            entry['price'] = price
        
        if ingredients:
            existing = entry.get('ingredients', [])
            entry['ingredients'] = list(set(existing + ingredients))
        if description:
            entry['description'] = description
        if notes:
            entry['notes'] = notes
        if menu_date:
            entry['menu_date'] = menu_date
        if menu_type:
            entry['menu_type'] = menu_type
    else:
        # Create new entry
        entry = {
            'id': f"dish_{int(datetime.now().timestamp())}_{hash(dish_name) % 10000:04d}",
            'dish_name': dish_name,
            'dish_name_normalized': normalized,
            'restaurant': restaurant,
            'full_line': full_line,  # The complete approved line
            'allergens': sorted(set(allergens)) if allergens else [],
            'ingredients': ingredients or [],
            'description': description,
            'price': price,
            'source': source,
            'confidence': confidence,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'correction_count': 1,
            'notes': notes,
            'menu_date': menu_date,
            'menu_type': menu_type,
        }
        db['entries'].append(entry)
    
    save_database(db)
    return entry


def infer_allergens_from_ingredients(text: str) -> List[str]:
    """
    Infer allergens from dish description/ingredients using AI knowledge.
    This uses the INGREDIENT_ALLERGENS mapping.
    """
    text_lower = text.lower()
    allergens = set()
    
    for ingredient, code in INGREDIENT_ALLERGENS.items():
        if ingredient in text_lower:
            allergens.add(code)
    
    return sorted(allergens)


def store_allergen_correction(
    dish_line: str,
    original_codes: str,
    corrected_codes: str,
    restaurant: str,
    context: Optional[str] = None
) -> Optional[Dict]:
    """
    Store a dish allergen correction from training data.
    
    Args:
        dish_line: The full line containing dish name and description
        original_codes: Original allergen codes (e.g., "d,n")
        corrected_codes: Corrected allergen codes (e.g., "d,n,v")
        restaurant: Restaurant identifier
        context: Additional context (e.g., surrounding menu items)
    
    Returns:
        The created/updated database entry, or None if couldn't parse
    """
    # Try to extract dish name from the line
    # Usually format is: "Dish Name - description... D,N,V"
    # or "Dish Name, ingredients, ingredients... d,n"
    
    # Remove the allergen codes from the end to get dish + description
    codes_pattern = r'[,\s]*[DNGVSEFC,\*]+\s*$'
    dish_desc = re.sub(codes_pattern, '', dish_line, flags=re.IGNORECASE).strip()
    
    # Try to extract just the dish name (before description)
    if ' - ' in dish_desc:
        dish_name = dish_desc.split(' - ')[0].strip()
        description = dish_desc.split(' - ', 1)[1].strip() if ' - ' in dish_desc else None
    elif ', ' in dish_desc:
        parts = dish_desc.split(', ')
        dish_name = parts[0].strip()
        description = ', '.join(parts[1:]) if len(parts) > 1 else None
    else:
        dish_name = dish_desc
        description = None
    
    if not dish_name or len(dish_name) < 2:
        return None
    
    # Parse the corrected allergens
    allergens = parse_allergen_codes(corrected_codes)
    
    if not allergens:
        return None
    
    # Parse actual ingredient names from description (split by comma)
    ingredients = []
    if description:
        # Split description by comma to get ingredient names
        ingredients = [ing.strip() for ing in description.split(',') if ing.strip()]
    
    # Store in database
    return upsert_dish(
        dish_name=dish_name,
        allergens=allergens,
        restaurant=restaurant,
        ingredients=ingredients if ingredients else None,
        description=description,
        source='training',
        notes=f"Learned: {original_codes} → {corrected_codes}"
    )


def learn_dish_from_correction(
    original_line: str,
    corrected_line: str,
    restaurant: str
) -> Optional[Dict]:
    """
    Learn the complete correct description for a dish from a correction.
    
    This stores the FULL CORRECTED LINE as the approved version of the dish.
    If this dish is seen again, the AI can compare against this approved description.
    
    Example:
        original: "Enfrijochiladas, black bean sauce, scrambled eggs, pork chorizo, pico de gallo D,G 15"
        corrected: "Enfrijochiladas, black bean sauce, scrambled eggs, bacon, pico de gallo, guajillo crema, cotija cheese D,G 15"
        
        Result: Stores "Enfrijochiladas" with the full corrected line as the approved description.
    
    Args:
        original_line: The original (incorrect) line
        corrected_line: The corrected (approved) line  
        restaurant: Restaurant identifier
        
    Returns:
        The created/updated database entry, or None if couldn't parse
    """
    # Parse the corrected line to extract components
    # Format: "Dish Name, description, description... ALLERGENS PRICE"
    
    # Extract price (number at the end)
    price_match = re.search(r'\s+(\d+(?:\.\d{2})?)\s*$', corrected_line)
    price = price_match.group(1) if price_match else None
    
    # Remove price from line for further parsing
    line_without_price = re.sub(r'\s+\d+(?:\.\d{2})?\s*$', '', corrected_line).strip()
    
    # Extract allergen codes (letters at the end like D,G,S or *D,G)
    allergen_match = re.search(r'\s+\*?([DNGVSEFC,\*]+)\s*$', line_without_price, re.IGNORECASE)
    allergens = []
    if allergen_match:
        allergens = parse_allergen_codes(allergen_match.group(1))
        line_without_allergens = re.sub(r'\s+\*?[DNGVSEFC,\*]+\s*$', '', line_without_price, flags=re.IGNORECASE).strip()
    else:
        line_without_allergens = line_without_price
    
    # Extract dish name (first part before comma)
    if ', ' in line_without_allergens:
        parts = line_without_allergens.split(', ')
        dish_name = parts[0].strip()
        description = ', '.join(parts[1:]).strip()
    else:
        dish_name = line_without_allergens
        description = None
    
    if not dish_name or len(dish_name) < 2:
        return None
    
    # Parse ingredients from description
    ingredients = []
    if description:
        # Split by comma and clean up
        ingredients = [ing.strip() for ing in description.split(',') if ing.strip()]
    
    # Store in database with the FULL CORRECTED LINE as the approved version
    return upsert_dish(
        dish_name=dish_name,
        allergens=allergens,
        restaurant=restaurant,
        ingredients=ingredients,
        description=description,
        full_line=corrected_line,  # Store the complete approved line!
        price=price,
        source='training',
        notes=f"Learned from correction. Original had different description."
    )


def _remove_price_from_line(line: str) -> str:
    """Remove price from end of a menu line for comparison purposes.
    
    Prices should NOT be compared because the same dish can have
    different prices at different restaurants or times.
    """
    # Remove trailing price (number at end, with or without decimals)
    return re.sub(r'\s+\d+(?:\.\d{2})?\s*$', '', line).strip()


def compare_dish_to_database(
    dish_line: str,
    restaurant: Optional[str] = None
) -> Optional[Dict]:
    """
    Compare a dish line against the database to find discrepancies.
    
    Returns information about what should be corrected if the dish
    is in the database with a different description.
    
    NOTE: Prices are IGNORED in comparison - the same dish can have
    different prices at different restaurants or times.
    
    Args:
        dish_line: The line to check
        restaurant: Optional restaurant identifier
        
    Returns:
        Dict with comparison results, or None if dish not in database
    """
    # Extract dish name from line
    if ', ' in dish_line:
        dish_name = dish_line.split(', ')[0].strip()
    else:
        dish_name = dish_line.split()[0] if dish_line.split() else None
    
    if not dish_name:
        return None
    
    # Look up in database
    known = lookup_dish(dish_name, restaurant)
    
    if not known or not known.get('full_line'):
        return None
    
    # Compare WITHOUT prices - prices can legitimately differ
    submitted_no_price = _remove_price_from_line(dish_line)
    approved_no_price = _remove_price_from_line(known['full_line'])
    
    return {
        'dish_name': dish_name,
        'submitted_line': dish_line,
        'approved_line': known['full_line'],
        'approved_description': approved_no_price,  # Without price for corrections
        'match': submitted_no_price == approved_no_price,
        'confidence': known.get('confidence', 0),
        'correction_count': known.get('correction_count', 0),
        'note': 'Price differences are ignored - only description/allergens compared'
    }


def get_statistics() -> Dict:
    """Get database statistics."""
    db = load_database()
    return db['statistics']


def search_dishes(query: str, restaurant: Optional[str] = None, limit: int = 10) -> List[Dict]:
    """Search for dishes by name."""
    db = load_database()
    normalized = normalize_dish_name(query)
    query_words = normalized.split()
    
    results = []
    for entry in db['entries']:
        if restaurant and entry['restaurant'] != restaurant:
            continue
        
        # Check if any query word matches
        if any(word in entry['dish_name_normalized'] for word in query_words):
            results.append(entry)
    
    # Sort by relevance
    results.sort(key=lambda e: (
        -sum(1 for w in query_words if w in e['dish_name_normalized']),
        -e.get('confidence', 0)
    ))
    
    return results[:limit]


def store_approved_dish(
    dish_line: str,
    restaurant: str,
    menu_date: str = None,
    menu_type: str = None,
    source_file: str = None
) -> Optional[Dict]:
    """
    Store a dish from an approved (redlined) document.
    
    This is the PRIMARY way to build the master catalog - every dish
    from an approved menu gets stored here.
    
    Args:
        dish_line: The full menu line (e.g., "Tuna Tartare, avocado, ponzu D,G 18")
        restaurant: Restaurant identifier
        menu_date: Date of the menu (YYYY-MM-DD or extracted from filename)
        menu_type: Type of menu (dinner, brunch, cocktails, etc.)
        source_file: The filename this was learned from
        
    Returns:
        The created/updated database entry, or None if couldn't parse
    """
    if not dish_line or len(dish_line.strip()) < 5:
        return None
    
    line_lower = dish_line.lower().strip()
    
    # Skip lines that are clearly not menu items
    skip_patterns = [
        'consuming raw', 'foodborne illness', 'allergen key', 
        'vegetarian', 'vegan', 'gluten free', 'dairy free',
        'step 1', 'step 2', 'step 3', 'obtain', 'design request',
        'page ', 'menu submission', 'restaurant name', 'venue',
        'template', 'brief', 'guidelines', 'rsh design'
    ]
    if any(pattern in line_lower for pattern in skip_patterns):
        return None
    
    # Skip lines that are ALL CAPS (headers/sections)
    if dish_line.isupper():
        return None
    
    # Skip very short lines (likely headers or single words)
    if len(dish_line.split()) < 2:
        return None
    
    # Parse the line to extract components
    # Format variations:
    # - "Dish Name, ingredient, ingredient... D,G 18"
    # - "Dish Name, ingredient (D, E, F)"
    # - "Dish Name, ingredient (V) 15"
    
    # Extract price (number at the end, possibly after allergens)
    price_match = re.search(r'\s+(\d+(?:\|\d+)?)\s*$', dish_line)
    price = price_match.group(1) if price_match else None
    
    # Remove price from line
    line_no_price = re.sub(r'\s+\d+(?:\|\d+)?\s*$', '', dish_line).strip()
    
    # Extract allergen codes - two patterns:
    # 1. At end without parens: "... D,G" or "... *D,G"
    # 2. In parentheses: "... (D, E, F)" or "... (V)"
    allergens = []
    
    # Pattern 1: Parens at end like (D, E, F) or (V)
    paren_match = re.search(r'\(([A-Z,\s\*]+)\)\s*$', line_no_price)
    if paren_match:
        allergen_str = paren_match.group(1).replace(' ', '')
        allergens = parse_allergen_codes(allergen_str)
        line_no_allergens = re.sub(r'\s*\([A-Z,\s\*]+\)\s*$', '', line_no_price).strip()
    else:
        # Pattern 2: No parens like "... D,G" or "... *D,G"
        allergen_match = re.search(r'\s+\*?([A-Z,\*]+)\s*$', line_no_price)
        if allergen_match:
            allergens = parse_allergen_codes(allergen_match.group(1))
            line_no_allergens = re.sub(r'\s+\*?[A-Z,\*]+\s*$', '', line_no_price).strip()
        else:
            line_no_allergens = line_no_price
    
    # Extract dish name and description
    if ', ' in line_no_allergens:
        parts = line_no_allergens.split(', ')
        dish_name = parts[0].strip()
        description = ', '.join(parts[1:]).strip()
        ingredients = [ing.strip() for ing in parts[1:] if ing.strip()]
    else:
        dish_name = line_no_allergens
        description = None
        ingredients = []
    
    # Skip if dish name is too short or looks invalid
    if not dish_name or len(dish_name) < 2:
        return None
    
    # Skip if dish name is a section header (ALL CAPS and short)
    if dish_name.isupper() and len(dish_name.split()) <= 3:
        return None
    
    # Skip if dish name starts with numbers (likely not a real dish)
    if dish_name[0].isdigit():
        return None
    
    # Store in database
    return upsert_dish(
        dish_name=dish_name,
        allergens=allergens,
        restaurant=restaurant,
        ingredients=ingredients,
        description=description,
        full_line=dish_line,
        price=price,
        source='approved_menu',
        confidence=0.8,  # High confidence - from approved document
        notes=f"From approved menu{f' ({menu_date})' if menu_date else ''}{f' - {menu_type}' if menu_type else ''}",
        menu_date=menu_date,
        menu_type=menu_type
    )


def store_dish_terminology_correction(
    dish_name: str,
    original_term: str,
    corrected_term: str,
    restaurant: str = 'global',
    context_paragraph: str = None
) -> Dict:
    """
    Store a terminology correction associated with a specific dish.
    
    This is for word preference corrections like:
    - "Red Paloma" with "crust" → "rim"
    - Any dish with "mayo" → "aioli"
    
    Next time the AI sees this dish, it will know to apply this correction
    with higher confidence.
    
    Args:
        dish_name: Name of the dish (e.g., "Red Paloma")
        original_term: The word that was changed (e.g., "crust")
        corrected_term: The preferred word (e.g., "rim")
        restaurant: Restaurant identifier
        context_paragraph: The full paragraph for reference
        
    Returns:
        The created/updated database entry
    """
    db = load_database()
    normalized = normalize_dish_name(dish_name)
    
    # Look for existing entry
    entry = None
    for e in db['entries']:
        if e['dish_name_normalized'] == normalized and e['restaurant'] == restaurant:
            entry = e
            break
    
    if entry:
        # Update existing entry
        entry['updated_at'] = datetime.now().isoformat()
        entry['correction_count'] = entry.get('correction_count', 0) + 1
        entry['confidence'] = min(1.0, entry.get('confidence', 0.5) + 0.15)
        
        # Add to terminology corrections list
        corrections = entry.get('terminology_corrections', [])
        correction_pair = {'from': original_term, 'to': corrected_term}
        if correction_pair not in corrections:
            corrections.append(correction_pair)
        entry['terminology_corrections'] = corrections
        
    else:
        # Create new entry focused on terminology
        entry = {
            'id': f"dish_{int(datetime.now().timestamp())}_{hash(dish_name) % 10000:04d}",
            'dish_name': dish_name,
            'dish_name_normalized': normalized,
            'restaurant': restaurant,
            'full_line': context_paragraph,
            'allergens': [],
            'ingredients': [],
            'description': None,
            'price': None,
            'source': 'terminology_training',
            'confidence': 0.6,  # Higher initial confidence for terminology
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'correction_count': 1,
            'terminology_corrections': [
                {'from': original_term, 'to': corrected_term}
            ],
            'notes': f"Learned terminology: '{original_term}' → '{corrected_term}'"
        }
        db['entries'].append(entry)
    
    save_database(db)
    return entry


def get_dish_corrections(dish_name: str, restaurant: str = None) -> Dict:
    """
    Get all known corrections for a dish.
    
    Returns a dict with:
    - allergens: Known allergen codes
    - terminology: List of {from, to} terminology corrections
    - full_line: The approved full line if known
    - confidence: How confident we are in this data
    
    Args:
        dish_name: The dish to look up
        restaurant: Optional restaurant filter
        
    Returns:
        Dict with correction info, or empty dict if dish unknown
    """
    entry = lookup_dish(dish_name, restaurant)
    
    if not entry:
        return {}
    
    return {
        'dish_name': entry.get('dish_name'),
        'allergens': entry.get('allergens', []),
        'terminology': entry.get('terminology_corrections', []),
        'full_line': entry.get('full_line'),
        'description': entry.get('description'),
        'confidence': entry.get('confidence', 0),
        'correction_count': entry.get('correction_count', 0),
    }


def export_for_ai_prompt() -> str:
    """
    Export database as text for inclusion in AI prompts.
    This helps the AI reviewer know about previously learned dish information.
    """
    db = load_database()
    
    if not db['entries']:
        return ""
    
    lines = ["KNOWN DISHES (from training data):"]
    lines.append("Use these approved descriptions when reviewing menus.")
    lines.append("NOTE: Prices may vary - do NOT flag price differences as errors.\n")
    
    # Collect terminology corrections across all dishes
    terminology_by_dish = {}
    
    # Group by restaurant
    by_restaurant = {}
    for entry in db['entries']:
        restaurant = entry['restaurant']
        if restaurant not in by_restaurant:
            by_restaurant[restaurant] = []
        by_restaurant[restaurant].append(entry)
        
        # Track terminology corrections
        if entry.get('terminology_corrections'):
            dish_name = entry['dish_name']
            for tc in entry['terminology_corrections']:
                if dish_name not in terminology_by_dish:
                    terminology_by_dish[dish_name] = []
                terminology_by_dish[dish_name].append(tc)
    
    for restaurant, dishes in by_restaurant.items():
        lines.append(f"\n{restaurant.replace('_', ' ').title()}:")
        for dish in sorted(dishes, key=lambda d: d['dish_name']):
            # Show description WITHOUT price (price can vary)
            if dish.get('full_line'):
                desc_no_price = _remove_price_from_line(dish['full_line'])
                lines.append(f"  ✓ {desc_no_price}")
            else:
                # Fall back to allergens only
                codes = ','.join(dish.get('allergens', []))
                desc = dish.get('description', '')
                if desc:
                    lines.append(f"  - {dish['dish_name']}, {desc} {codes}")
                else:
                    lines.append(f"  - {dish['dish_name']}: {codes}")
            
            # Show terminology corrections for this dish
            if dish.get('terminology_corrections'):
                for tc in dish['terminology_corrections']:
                    lines.append(f"      ⚠ Use \"{tc['to']}\" not \"{tc['from']}\"")
    
    # Summary of dish-specific terminology corrections
    if terminology_by_dish:
        lines.append("\n\nDISH-SPECIFIC TERMINOLOGY:")
        lines.append("When reviewing these dishes, apply these corrections with HIGH confidence:\n")
        for dish_name, corrections in sorted(terminology_by_dish.items()):
            for tc in corrections:
                lines.append(f"  • {dish_name}: \"{tc['from']}\" → \"{tc['to']}\"")
    
    return '\n'.join(lines)


# CLI interface
if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python dish_allergen_db.py stats")
        print("  python dish_allergen_db.py search <query>")
        print("  python dish_allergen_db.py add <dish> <allergens> <restaurant>")
        print("  python dish_allergen_db.py export")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'stats':
        stats = get_statistics()
        print("Dish Allergen Database Statistics:")
        print(json.dumps(stats, indent=2))
    
    elif command == 'search' and len(sys.argv) > 2:
        query = ' '.join(sys.argv[2:])
        results = search_dishes(query)
        print(f"Search results for '{query}':")
        for r in results:
            print(f"  - {r['dish_name']} ({r['restaurant']}): {','.join(r['allergens'])}")
    
    elif command == 'add' and len(sys.argv) >= 5:
        dish = sys.argv[2]
        codes = parse_allergen_codes(sys.argv[3])
        restaurant = sys.argv[4]
        entry = upsert_dish(dish, codes, restaurant, source='manual')
        print(f"Added: {entry['dish_name']} with allergens {','.join(entry['allergens'])}")
    
    elif command == 'export':
        print(export_for_ai_prompt())
    
    else:
        print(f"Unknown command: {command}")
