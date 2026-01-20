"""
AI Corrector Integration
=========================
Integrates with OpenAI GPT-4 to provide intelligent menu corrections
based on SOP rules and best practices.

Now includes dish allergen database integration for intelligent allergen suggestions.
Includes learned terminology corrections from training.
"""

import os
import json
from pathlib import Path
from typing import Optional, List
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import dish allergen database
try:
    from dish_allergen_db import (
        lookup_dish,
        search_dishes,
        export_for_ai_prompt,
        infer_allergens_from_ingredients,
        get_dish_corrections,
        ALLERGEN_CODES
    )
    DISH_DB_AVAILABLE = True
except ImportError:
    DISH_DB_AVAILABLE = False

# Import known corrections/terminology
try:
    from known_corrections import (
        TERMINOLOGY_CORRECTIONS,
        CONTEXT_HINTS,
        KNOWN_PAIRS
    )
    CORRECTIONS_AVAILABLE = True
except ImportError:
    TERMINOLOGY_CORRECTIONS = {}
    CONTEXT_HINTS = {}
    KNOWN_PAIRS = set()
    CORRECTIONS_AVAILABLE = False


class AICorrector:
    """
    Handles AI-powered text correction using OpenAI's API.
    """

    # Default allergen codes (from RSH SOP)
    DEFAULT_ALLERGEN_CODES = {
        'D': 'Dairy',
        'G': 'Gluten',
        'N': 'Nuts',
        'S': 'Shellfish',
        'V': 'Vegetarian',
        'VG': 'Vegan',
    }

    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4o", allergen_codes: Optional[dict] = None):
        """
        Initialize the AI corrector.

        Args:
            api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var
            model: The model to use (default: gpt-4o)
            allergen_codes: Optional dict of allergen codes to use. If None, uses defaults.
                           This allows documents with their own allergen legend to override.
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY environment variable.")

        self.client = OpenAI(api_key=self.api_key)
        self.model = model
        self.allergen_codes = allergen_codes or self.DEFAULT_ALLERGEN_CODES.copy()
        self.system_prompt = self._build_system_prompt()

    def set_allergen_codes(self, allergen_codes: dict):
        """
        Update the allergen codes used for corrections.

        Use this when a document has its own allergen legend that should
        override the default SOP codes.

        Args:
            allergen_codes: Dict mapping codes to their meanings (e.g., {'D': 'Dairy', 'S': 'Soya'})
        """
        self.allergen_codes = allergen_codes
        # Rebuild the system prompt with new allergen codes
        self.system_prompt = self._build_system_prompt()
    
    def _build_system_prompt(self) -> str:
        """
        Build the system prompt for menu corrections.
        Includes learned terminology rules from training.
        Uses document-specific allergen codes if set.
        """
        # Build terminology corrections section
        terminology_section = self._build_terminology_section()

        # Build dish-specific corrections if database available
        dish_corrections_section = ""
        if DISH_DB_AVAILABLE:
            dish_corrections_section = self._build_dish_corrections_section()

        # Build allergen codes list from current document's codes
        allergen_list = ", ".join(f"{code} ({name})" for code, name in sorted(self.allergen_codes.items()))

        return f"""You are an expert menu editor for RSH Design. Your task is to correct menu item text according to strict formatting guidelines.

CRITICAL RULES:
1. Return ONLY the corrected text - no explanations, no comments, no markdown

2. PRESERVE ALL EXISTING FORMATTING:
   - DO NOT add or remove bold, italic, or any text formatting
   - Return plain text only - no markdown, no ** for bold, no formatting changes
   - Keep existing asterisks (*) in their positions

3. ALLERGEN CODES - CRITICAL:
   - NEVER REMOVE any existing allergen codes - the chef knows their ingredients
   - You may only ADD allergen codes, never delete or change existing ones
   - If a dish has "D,E,F,SE" keep ALL of those codes exactly as written
   - Valid allergen codes for THIS document: {allergen_list}
   - Only ADD codes if you're very confident based on visible ingredients
   - Format: Place allergen codes at the very END of the line, after any price
   - When in doubt, leave allergen codes completely unchanged

4. PRESERVE EXISTING CAPITALIZATION - BE VERY CONSERVATIVE:
   - DO NOT change the capitalization of dish names, section headers, or titles
   - DO NOT lowercase words that are already capitalized (they are intentional)
   - DO NOT change "The Spark", "El Primer Encuentro", "Chilean Sea Bass", etc.
   - Only change capitalization if something is ALL CAPS that shouldn't be

5. Fix ONLY clear spelling errors:
   - "tartar" → "tartare" (for raw fish/meat preparations)
   - "pre-fix" or "prefix" → "prix fixe" (French term for fixed-price menu)
   - "avacado" → "avocado"
   - "mozarella" → "mozzarella"
   - "parmesian" → "parmesan"
   - "Ceasar/Cesar" → "Caesar"
   - "biters" → "bitters" (cocktail bitters)
   - "expresso" → "espresso"

6. RSH TERMINOLOGY CORRECTIONS (APPLY THESE):
{terminology_section}

7. RAW ITEM ASTERISK PLACEMENT:
   - NEVER REMOVE existing asterisks (*) - the chef knows their dishes
   - You may only ADD asterisks for raw/undercooked items, never delete existing ones
   - IMPORTANT: Place new asterisks at the END of the description, BEFORE any allergen codes
   - Format: "dish name, ingredients * ALLERGEN_CODES"
   - Example: "Tuna Tartare, avocado, ponzu * D,G" (asterisk BEFORE D,G)
   - If there are no allergen codes, put asterisk at the very end
   - Raw items include: tartare, carpaccio, raw fish, sushi, sashimi, caviar, oysters, raw egg, ceviche

8. Formatting rules:
   - DO NOT change ingredient separators - keep commas as commas, keep hyphens as hyphens
   - DO NOT split compound words (yuzu-lime, cacao-ancho, cucumber-cilantro)
   - Dual prices: use " | " (space-bar-space) to separate two prices, not "/"
   - Enforce diacritics: jalapeño, crème brûlée, purée, soufflé, flambéed, etc.

9. NEVER CHANGE PRICES OR NUMBERS - ABSOLUTE RULE:
   - NEVER modify any numbers in the text - prices, quantities, counts
   - If you see "295" keep it as "295" - do NOT change to 299 or any other number
   - If you see "20 pcs" keep it as "20 pcs" exactly
   - Prices and numbers are NEVER spelling errors - leave them alone
   - This includes: prices, portion sizes, piece counts, temperatures, years

10. DO NOT CHANGE:
   - Section headers like "The Spark – "El Primer Encuentro""
   - Dish names like "Chilean Sea Bass en Pipián Verde"
   - Title capitalization like "A Love Story"
   - Compound words with hyphens
   - Prices and numbers

11. If the text is already correct, return it UNCHANGED
{dish_corrections_section}

EXAMPLES:
Input: "Tuna Tartar Tostada, avocado mousse, hibiscus ponzu D,G"
Output: "Tuna Tartare Tostada, avocado mousse, hibiscus ponzu * D,G"

Input: "Sushi Tamaki Hand Roll, avocado, cucumber, sriracha aioli, masago, bubu arare"
Output: "Sushi Tamaki Hand Roll, avocado, cucumber, sriracha aioli, masago, bubu arare *"
(Note: asterisk added for raw fish - masago is fish roe)

Input: "Filete de Wagyu, australian Wagyu tenderloin, soft quail egg D,E"
Output: "Filete de Wagyu, australian Wagyu tenderloin, soft quail egg * D,E"

Input: "Red Paloma, tequila, grapefruit, lime, salt crust"
Output: "Red Paloma, tequila, grapefruit, lime, salt rim"

Input: "hibiscus infused blanco tequila, lime, ginger beer, tortilla crust"
Output: "hibiscus infused blanco tequila, lime, ginger beer, tortilla rim"

Input: "roasted plantain purée, shaved truffle D,N"
Output: "roasted plantain purée, shaved truffle D,N"
"""

    def _build_terminology_section(self) -> str:
        """
        Build the terminology corrections section from learned rules.
        """
        lines = []
        
        # Add terminology corrections
        if CORRECTIONS_AVAILABLE and TERMINOLOGY_CORRECTIONS:
            for original, corrected in TERMINOLOGY_CORRECTIONS.items():
                hint = CONTEXT_HINTS.get((original, corrected), {})
                note = hint.get('note', '')
                context = hint.get('item_types', [])
                
                if context:
                    context_str = f" (especially for {', '.join(context)})"
                else:
                    context_str = ""
                
                lines.append(f'   - "{original}" → "{corrected}"{context_str}')
                if note:
                    lines.append(f'     Note: {note}')
        
        # Add some key known pairs that are one-directional preferences
        if not lines:
            # Fallback if corrections not loaded
            lines = [
                '   - "crust" → "rim" (for cocktails/drinks with glass rims)',
                '   - "bbq" → "barbeque sauce"',
            ]
        
        return '\n'.join(lines)
    
    def _build_dish_corrections_section(self) -> str:
        """
        Build dish-specific corrections from the database.
        
        NOTE: We no longer include the full dish database in the prompt.
        This was causing timeouts/failures due to prompt size.
        
        Instead, we rely on:
        1. The AI's built-in knowledge to infer allergens from ingredients
        2. The terminology corrections from known_corrections.py
        3. The allergen code definitions in the main prompt
        
        The dish database is still used for:
        - Training (storing learned corrections)
        - Future: per-paragraph lookups for specific dish matches
        """
        # Return empty - AI can infer allergens from ingredients
        # Terminology corrections are handled by _build_terminology_section()
        return ""
    
    def correct_text(self, text: str) -> str:
        """
        Correct a single menu item text using AI.
        
        Args:
            text: The original menu text
            
        Returns:
            The corrected text
        """
        if not text.strip():
            return text
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": text}
                ],
                temperature=0.1,  # Low temperature for consistent corrections
                max_tokens=500
            )
            
            corrected = response.choices[0].message.content.strip()
            return corrected
            
        except Exception as e:
            print(f"Error correcting text: {e}")
            # Return original text if correction fails
            return text
    
    def correct_with_context(self, text: str, sop_rules: Optional[str] = None, restaurant: Optional[str] = None) -> str:
        """
        Correct text with additional SOP context and dish database knowledge.
        
        Args:
            text: The original menu text
            sop_rules: Optional additional SOP rules to include
            restaurant: Optional restaurant identifier for dish lookups
            
        Returns:
            The corrected text
        """
        if not text.strip():
            return text
        
        # Build context-aware prompt
        user_message = text
        
        # Add dish database context if available
        dish_context = self._get_dish_context(text, restaurant)
        
        if sop_rules or dish_context:
            context_parts = []
            if sop_rules:
                context_parts.append(f"SOP Context:\n{sop_rules}")
            if dish_context:
                context_parts.append(f"Known Dish Allergens:\n{dish_context}")
            user_message = f"{chr(10).join(context_parts)}\n\nMenu Item:\n{text}"
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_message}
                ],
                temperature=0.1,
                max_tokens=500
            )
            
            corrected = response.choices[0].message.content.strip()
            return corrected
            
        except Exception as e:
            print(f"Error correcting text: {e}")
            return text
    
    def _get_dish_context(self, text: str, restaurant: Optional[str] = None) -> str:
        """
        Get dish database context for allergen suggestions.
        
        Args:
            text: The menu item text
            restaurant: Optional restaurant identifier
            
        Returns:
            Context string with known allergen information
        """
        if not DISH_DB_AVAILABLE:
            return ""
        
        context_parts = []
        
        # Try to extract dish name (usually first part before comma or dash)
        dish_name = text.split(',')[0].split(' - ')[0].strip()
        
        # Look up in database
        known_dish = lookup_dish(dish_name, restaurant)
        if known_dish:
            allergens = ','.join(known_dish['allergens'])
            context_parts.append(f"Known: {dish_name} = {allergens} (confidence: {known_dish['confidence']:.0%})")
        
        # Also infer from ingredients
        inferred = infer_allergens_from_ingredients(text)
        if inferred:
            inferred_str = ','.join(inferred)
            context_parts.append(f"Inferred from ingredients: {inferred_str}")
        
        return '\n'.join(context_parts)
    
    def suggest_allergens(self, dish_name: str, description: str, restaurant: Optional[str] = None) -> List[str]:
        """
        Suggest allergens for a dish based on database + AI inference.
        
        Args:
            dish_name: Name of the dish
            description: Dish description/ingredients
            restaurant: Optional restaurant identifier
            
        Returns:
            List of suggested allergen codes
        """
        suggested = set()
        
        if DISH_DB_AVAILABLE:
            # Check database first
            known = lookup_dish(dish_name, restaurant)
            if known and known['confidence'] > 0.7:
                return sorted(known['allergens'])
            
            # Infer from ingredients
            inferred = infer_allergens_from_ingredients(f"{dish_name} {description}")
            suggested.update(inferred)
        
        # Use AI for additional suggestions if needed
        if not suggested:
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": """You are an allergen expert. Given a dish name and description, identify likely allergens.
Return ONLY comma-separated allergen codes:
D=Dairy, N=Nuts, G=Gluten, V=Vegetarian, S=Vegan, E=Eggs, F=Fish, C=Crustaceans, SE=Sesame, SY=Soy, M=Mustard

Example: D,N,G"""},
                        {"role": "user", "content": f"Dish: {dish_name}\nDescription: {description}"}
                    ],
                    temperature=0.1,
                    max_tokens=50
                )
                
                ai_codes = response.choices[0].message.content.strip().upper().split(',')
                for code in ai_codes:
                    code = code.strip()
                    if DISH_DB_AVAILABLE and code in ALLERGEN_CODES:
                        suggested.add(code)
                    elif code in ['D', 'N', 'G', 'V', 'S', 'E', 'F', 'C', 'SE', 'SY', 'M']:
                        suggested.add(code)
                        
            except Exception as e:
                print(f"Error getting AI allergen suggestions: {e}")
        
        return sorted(suggested)


class BatchAICorrector:
    """
    Handles batch corrections more efficiently by processing multiple
    items in a single API call.
    """
    
    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4o"):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not found.")
        
        self.client = OpenAI(api_key=self.api_key)
        self.model = model
        self.system_prompt = self._build_system_prompt()
    
    def _build_system_prompt(self) -> str:
        # Build terminology section
        terminology_lines = []
        if CORRECTIONS_AVAILABLE and TERMINOLOGY_CORRECTIONS:
            for original, corrected in TERMINOLOGY_CORRECTIONS.items():
                terminology_lines.append(f'- "{original}" → "{corrected}"')
        else:
            terminology_lines = [
                '- "crust" → "rim" (for cocktails with glass rims)',
            ]
        terminology_section = '\n'.join(terminology_lines)
        
        return f"""You are an expert menu editor. You will receive multiple menu items separated by "|||".
Return the corrected items in the SAME ORDER, also separated by "|||".

CRITICAL RULES:
- NEVER CHANGE PRICES OR NUMBERS - if you see "295" keep it as "295", not 299
- NEVER REMOVE ALLERGEN CODES - you may only ADD allergens, never delete existing ones
- NEVER REMOVE ASTERISKS (*) - you may only ADD asterisks for raw items, never delete existing ones
- PRESERVE ALL EXISTING FORMATTING - no bold, no markdown, plain text only
- PRESERVE EXISTING CAPITALIZATION - do not change dish names, section headers, or titles
- Fix only clear spelling errors: tartar→tartare, avacado→avocado, mozarella→mozzarella, parmesian→parmesan, Ceasar→Caesar, pre-fix→prix fixe
- DO NOT change ingredient separators - keep commas and hyphens as they are
- Dual prices: use " | " (space-bar-space), not "/"
- Enforce diacritics: jalapeño, crème brûlée, purée, soufflé, flambéed
- RAW ITEM ASTERISK: Place asterisk (*) at END of description, BEFORE allergen codes
  Example: "Tuna Tartare, avocado * D,G" (asterisk before allergens)
- If an item is correct, return it UNCHANGED
- Return ONLY the corrected items, no other text

RSH TERMINOLOGY CORRECTIONS (ALWAYS APPLY):
{terminology_section}

Examples:
Input: "Tuna Tartar Tostada, avocado mousse D,G|||The Spark – "El Primer Encuentro""
Output: "Tuna Tartare Tostada, avocado mousse * D,G|||The Spark – "El Primer Encuentro""

Input: "Sushi Hand Roll, avocado, masago, bubu arare VG|||Red Paloma, tequila, salt crust"
Output: "Sushi Hand Roll, avocado, masago, bubu arare * VG|||Red Paloma, tequila, salt rim"
"""
    
    def correct_batch(self, texts: list[str]) -> list[str]:
        """
        Correct multiple texts in a single API call.
        
        Args:
            texts: List of original texts
            
        Returns:
            List of corrected texts in the same order
        """
        if not texts:
            return []
        
        # Join texts with delimiter
        batch_input = "|||".join(texts)
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": batch_input}
                ],
                temperature=0.1,
                max_tokens=2000
            )
            
            corrected_batch = response.choices[0].message.content.strip()
            corrected_texts = corrected_batch.split("|||")
            
            # Ensure we have the same number of outputs as inputs
            if len(corrected_texts) != len(texts):
                print(f"Warning: Expected {len(texts)} outputs, got {len(corrected_texts)}")
                # Fall back to original texts
                return texts
            
            return corrected_texts
            
        except Exception as e:
            print(f"Error in batch correction: {e}")
            return texts


# Example usage and testing
if __name__ == "__main__":
    # Test with a simple example
    try:
        corrector = AICorrector()
        
        test_texts = [
            "Guacamole - Fresh avacado, lime, cilantro - $12",
            "Ceasar Salad - Romaine lettuce, parmesian cheese - $14",
            "Margherita Pizza - tomato sauce, mozarella, basil - $16"
        ]
        
        print("Testing AI Corrector:")
        print("-" * 60)
        for text in test_texts:
            corrected = corrector.correct_text(text)
            print(f"Original:  {text}")
            print(f"Corrected: {corrected}")
            print()
        
    except ValueError as e:
        print(f"Error: {e}")
        print("\nTo use this module, set your OpenAI API key:")
        print("export OPENAI_API_KEY='your-api-key-here'")

