"""
Known Correction Pairs
======================
This file contains terminology pairs that the training system should
recognize as valid corrections, even if they only appear once.

Add new pairs here as you discover them during training reviews.
The training pipeline automatically imports this file.

Format: (original, corrected)
- Add BOTH directions if the correction is bidirectional
- Example: ('mayo', 'aioli'), ('aioli', 'mayo')
"""

# Terminology preferences (bidirectional)
KNOWN_PAIRS = {
    # NOTE: mayo/aioli removed - not an absolute rule, clients may prefer either

    # Abbreviations
    ('bbq', 'barbeque'), ('barbeque', 'bbq'),
    ('bbq', 'barbecue'), ('barbecue', 'bbq'),
    
    # Raw preparations
    ('tartare', 'tartar'), ('tartar', 'tartare'),
    
    # Cocktail/drink terminology
    ('crust', 'rim'),  # Glass rim, not "crust" (e.g., "salt rim" not "salt crust")
    ('garnished', 'topped'),
    ('garnish', 'top'),
    
    # Diacritics - French terms
    ('puree', 'purée'), ('purée', 'puree'),
    ('flambe', 'flambé'), ('flambé', 'flambe'),
    ('cafe', 'café'), ('café', 'cafe'),
    ('creme', 'crème'), ('crème', 'creme'),
    ('souffle', 'soufflé'), ('soufflé', 'souffle'),
    ('saute', 'sauté'), ('sauté', 'saute'),
    ('entree', 'entrée'), ('entrée', 'entree'),
    ('pate', 'pâté'), ('pâté', 'pate'),
    ('naive', 'naïve'), ('naïve', 'naive'),
    
    # Diacritics - Spanish terms
    ('jalapeno', 'jalapeño'), ('jalapeño', 'jalapeno'),
    ('habanero', 'habañero'), ('habañero', 'habanero'),
    ('pina', 'piña'), ('piña', 'pina'),
    ('nino', 'niño'), ('niño', 'nino'),
    ('ano', 'año'), ('año', 'ano'),
    
    # Common misspellings
    ('cesar', 'caesar'), ('caesar', 'cesar'),
    ('ceasar', 'caesar'), ('caesar', 'ceasar'),
    ('parmesan', 'parmigiano'), ('parmigiano', 'parmesan'),
    ('mozarella', 'mozzarella'), ('mozzarella', 'mozarella'),
    ('cappucino', 'cappuccino'), ('cappuccino', 'cappucino'),
    ('expresso', 'espresso'), ('espresso', 'expresso'),
    ('biters', 'bitters'), ('bitters', 'biters'),  # cocktail bitters
    
    # Spelling variations
    ('yogurt', 'yoghurt'), ('yoghurt', 'yogurt'),
    ('donut', 'doughnut'), ('doughnut', 'donut'),
    ('ketchup', 'catsup'), ('catsup', 'ketchup'),
    
    # Term standardization
    ('shrimp', 'prawn'), ('prawn', 'shrimp'),
}

# Terminology pairs that are NOT bidirectional (one-way corrections)
# These are RSH-specific word preferences: always use the corrected term
TERMINOLOGY_CORRECTIONS = {
    'crust': 'rim',           # For cocktails: "salt rim" not "salt crust"
    # NOTE: mayo/aioli removed - not an absolute rule, clients may prefer either
    'bbq': 'barbeque sauce',  # Expand abbreviation
    'sorbete': 'sorbet',      # Spanish to English/French
}

# Context hints: what type of item a correction typically applies to
# This helps the AI be more confident when it sees the dish again
CONTEXT_HINTS = {
    ('crust', 'rim'): {
        'item_types': ['cocktail', 'drink', 'beverage'],
        'keywords': ['paloma', 'margarita', 'martini', 'rim', 'salt', 'sugar', 'chili'],
        'note': 'Glass rim terminology - use "rim" for cocktail glasses, not "crust"'
    },
    # NOTE: mayo/aioli context hints removed - not an absolute rule
}

# Common abbreviations that should be expanded
KNOWN_ABBREVIATIONS = {
    'bbq': 'barbeque',
    'msg': 'monosodium glutamate',
    'evoo': 'extra virgin olive oil',
    'oj': 'orange juice',
    'pb': 'peanut butter',
    'gf': 'gluten free',
    'v': 'vegetarian',
    'vg': 'vegan',
}


def is_known_pair(original: str, corrected: str) -> bool:
    """Check if this is a known correction pair."""
    orig_lower = original.lower().strip()
    corr_lower = corrected.lower().strip()
    return (orig_lower, corr_lower) in KNOWN_PAIRS


def is_known_abbreviation(text: str) -> bool:
    """Check if this is a known abbreviation."""
    return text.lower().strip() in KNOWN_ABBREVIATIONS


def is_terminology_correction(original: str) -> bool:
    """Check if this is a known terminology correction (one-way)."""
    return original.lower().strip() in TERMINOLOGY_CORRECTIONS


def get_terminology_correction(original: str) -> str:
    """Get the correct terminology for a word."""
    return TERMINOLOGY_CORRECTIONS.get(original.lower().strip(), original)


def get_context_hints(original: str, corrected: str) -> dict:
    """
    Get context hints for a correction pair.
    
    Returns dict with:
    - item_types: List of item types this applies to (cocktail, food, etc.)
    - keywords: Keywords that increase confidence
    - note: Explanation of the correction
    """
    key = (original.lower().strip(), corrected.lower().strip())
    return CONTEXT_HINTS.get(key, {})

