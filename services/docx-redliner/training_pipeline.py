"""
Training Pipeline for Menu Redliner
====================================
This module enables learning from historical document pairs (original + human-redlined)
to continuously improve the AI correction model.

Features:
- Batch ingestion of document pairs
- Pattern extraction from human corrections
- Rule generation and refinement
- Prompt optimization
- Training metrics and analytics
"""

import os
import json
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from docx import Document
from collections import defaultdict, Counter
import difflib
from datetime import datetime
import re


class TrainingPairAnalyzer:
    """
    Analyzes pairs of original and human-redlined documents to extract
    correction patterns and rules.
    """
    
    def __init__(self):
        self.corrections = []
        self.patterns = defaultdict(list)
        self.rule_candidates = []
        
    def load_document_pair(self, original_path: str, redlined_path: str) -> Dict:
        """
        Load and analyze a pair of documents.
        
        Args:
            original_path: Path to original document
            redlined_path: Path to human-redlined document
            
        Returns:
            Dictionary containing analysis results
        """
        original_doc = Document(original_path)
        redlined_doc = Document(redlined_path)
        
        # Extract text paragraphs
        original_paras = [p.text for p in original_doc.paragraphs if p.text.strip()]
        redlined_paras = [p.text for p in redlined_doc.paragraphs if p.text.strip()]
        
        # Also extract formatting information
        original_formatted = self._extract_formatted_content(original_doc)
        redlined_formatted = self._extract_formatted_content(redlined_doc)
        
        pair_analysis = {
            'original_path': original_path,
            'redlined_path': redlined_path,
            'timestamp': datetime.now().isoformat(),
            'text_corrections': [],
            'formatting_corrections': [],
            'metadata': {
                'original_paras': len(original_paras),
                'redlined_paras': len(redlined_paras)
            }
        }
        
        # Analyze text differences
        text_diffs = self._analyze_text_differences(original_paras, redlined_paras)
        pair_analysis['text_corrections'] = text_diffs
        
        # Analyze formatting differences
        format_diffs = self._analyze_formatting_differences(
            original_formatted, 
            redlined_formatted
        )
        pair_analysis['formatting_corrections'] = format_diffs
        
        return pair_analysis
    
    def _extract_formatted_content(self, doc: Document) -> List[Dict]:
        """
        Extract text content with formatting information.
        """
        formatted_content = []
        
        for para in doc.paragraphs:
            if not para.text.strip():
                continue
                
            para_info = {
                'text': para.text,
                'alignment': str(para.alignment),
                'runs': []
            }
            
            for run in para.runs:
                run_info = {
                    'text': run.text,
                    'bold': run.bold,
                    'italic': run.italic,
                    'underline': run.underline,
                    'font_name': run.font.name,
                    'font_size': run.font.size.pt if run.font.size else None,
                    'strike': run.font.strike,
                    'highlight': str(run.font.highlight_color) if run.font.highlight_color else None,
                    'color': str(run.font.color.rgb) if run.font.color.rgb else None
                }
                para_info['runs'].append(run_info)
            
            formatted_content.append(para_info)
        
        return formatted_content
    
    def _analyze_text_differences(
        self, 
        original: List[str], 
        redlined: List[str]
    ) -> List[Dict]:
        """
        Analyze text-level differences between documents.
        """
        corrections = []
        
        # Use difflib to find matching paragraphs
        matcher = difflib.SequenceMatcher(None, original, redlined)
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'replace':
                # Text was changed
                for orig_idx in range(i1, i2):
                    for redl_idx in range(j1, j2):
                        correction = self._extract_correction_details(
                            original[orig_idx],
                            redlined[redl_idx]
                        )
                        if correction:
                            corrections.append(correction)
            elif tag == 'delete':
                # Content was removed
                for orig_idx in range(i1, i2):
                    corrections.append({
                        'type': 'deletion',
                        'original': original[orig_idx],
                        'corrected': '',
                        'category': 'content_removal'
                    })
            elif tag == 'insert':
                # Content was added
                for redl_idx in range(j1, j2):
                    corrections.append({
                        'type': 'insertion',
                        'original': '',
                        'corrected': redlined[redl_idx],
                        'category': 'content_addition'
                    })
        
        return corrections
    
    def _extract_correction_details(self, original: str, corrected: str) -> Optional[Dict]:
        """
        Extract detailed information about a specific correction.
        """
        if original == corrected:
            return None
        
        # Categorize the type of correction
        correction = {
            'type': 'replacement',
            'original': original,
            'corrected': corrected,
            'category': self._categorize_correction(original, corrected),
            'word_diffs': self._get_word_level_diffs(original, corrected)
        }
        
        return correction
    
    def _categorize_correction(self, original: str, corrected: str) -> str:
        """
        Automatically categorize the type of correction.
        """
        # Check for common patterns
        
        # Spelling correction
        if self._is_spelling_correction(original, corrected):
            return 'spelling'
        
        # Case change
        if original.lower() == corrected.lower():
            return 'case_change'
        
        # Punctuation/separator change
        if self._is_punctuation_change(original, corrected):
            return 'punctuation'
        
        # Diacritic addition
        if self._is_diacritic_change(original, corrected):
            return 'diacritics'
        
        # Price format
        if '$' in original or '$' in corrected or '|' in original or '|' in corrected:
            return 'price_format'
        
        # Separator change (/ vs -)
        if (' / ' in corrected and ' - ' in original) or (' - ' in corrected and ' / ' in original):
            return 'separator'
        
        return 'general'
    
    def _is_spelling_correction(self, original: str, corrected: str) -> bool:
        """Check if this is a spelling correction."""
        # Simple heuristic: similar length, high character overlap
        if abs(len(original) - len(corrected)) > 3:
            return False
        
        orig_words = set(original.lower().split())
        corr_words = set(corrected.lower().split())
        
        # Check for word substitutions that might be spelling
        if len(orig_words) == len(corr_words):
            diff_words = orig_words.symmetric_difference(corr_words)
            if len(diff_words) <= 2:  # Only 1-2 words changed
                return True
        
        return False
    
    def _is_punctuation_change(self, original: str, corrected: str) -> bool:
        """Check if this is primarily a punctuation change."""
        # Remove all punctuation and compare
        orig_clean = re.sub(r'[^\w\s]', '', original)
        corr_clean = re.sub(r'[^\w\s]', '', corrected)
        
        return orig_clean == corr_clean
    
    def _is_diacritic_change(self, original: str, corrected: str) -> bool:
        """Check if diacritics were added/changed."""
        import unicodedata
        
        # Normalize to remove diacritics
        orig_norm = unicodedata.normalize('NFD', original)
        orig_base = ''.join(c for c in orig_norm if unicodedata.category(c) != 'Mn')
        
        corr_norm = unicodedata.normalize('NFD', corrected)
        corr_base = ''.join(c for c in corr_norm if unicodedata.category(c) != 'Mn')
        
        return orig_base.lower() == corr_base.lower()
    
    def _get_word_level_diffs(self, original: str, corrected: str) -> List[Dict]:
        """
        Get word-level differences between two strings.
        """
        orig_words = original.split()
        corr_words = corrected.split()
        
        matcher = difflib.SequenceMatcher(None, orig_words, corr_words)
        diffs = []
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag != 'equal':
                diffs.append({
                    'operation': tag,
                    'original_words': ' '.join(orig_words[i1:i2]),
                    'corrected_words': ' '.join(corr_words[j1:j2])
                })
        
        return diffs
    
    def _analyze_formatting_differences(
        self, 
        original: List[Dict], 
        redlined: List[Dict]
    ) -> List[Dict]:
        """
        Analyze formatting differences between documents.
        """
        format_corrections = []
        
        # Compare formatting for similar paragraphs
        for orig_para in original:
            for redl_para in redlined:
                # If text is similar, check formatting
                if self._text_similarity(orig_para['text'], redl_para['text']) > 0.8:
                    if orig_para['alignment'] != redl_para['alignment']:
                        format_corrections.append({
                            'type': 'alignment',
                            'text': orig_para['text'][:50],
                            'original': orig_para['alignment'],
                            'corrected': redl_para['alignment']
                        })
        
        return format_corrections
    
    def _text_similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity ratio between two texts."""
        return difflib.SequenceMatcher(None, text1, text2).ratio()


class RuleGenerator:
    """
    Generates rules from analyzed correction patterns.
    """
    
    def __init__(self):
        self.rule_templates = {
            'spelling': 'Correct spelling: "{original}" → "{corrected}"',
            'diacritics': 'Use proper diacritics: "{original}" → "{corrected}"',
            'punctuation': 'Fix punctuation: "{original}" → "{corrected}"',
            'separator': 'Use correct separator: "{original}" → "{corrected}"',
            'case_change': 'Apply correct case: "{original}" → "{corrected}"',
            'price_format': 'Format price correctly: "{original}" → "{corrected}"'
        }
    
    def generate_rules_from_corrections(
        self, 
        corrections: List[Dict],
        min_occurrences: int = 2
    ) -> List[Dict]:
        """
        Generate rules from a list of corrections.
        
        Args:
            corrections: List of correction dictionaries
            min_occurrences: Minimum times a pattern must appear to become a rule
            
        Returns:
            List of generated rules
        """
        # Group corrections by category
        by_category = defaultdict(list)
        for corr in corrections:
            if corr.get('type') == 'replacement':
                by_category[corr['category']].append(corr)
        
        generated_rules = []
        
        # Find patterns within each category
        for category, corr_list in by_category.items():
            patterns = self._find_patterns(corr_list)
            
            for pattern, occurrences in patterns.items():
                if occurrences >= min_occurrences:
                    rule = self._create_rule(category, pattern, occurrences)
                    generated_rules.append(rule)
        
        return generated_rules
    
    def _find_patterns(self, corrections: List[Dict]) -> Dict[Tuple[str, str], int]:
        """
        Find recurring patterns in corrections.
        """
        pattern_count = Counter()
        
        for corr in corrections:
            # Extract word-level changes
            for word_diff in corr.get('word_diffs', []):
                if word_diff['operation'] == 'replace':
                    orig = word_diff['original_words'].lower()
                    corr_text = word_diff['corrected_words'].lower()
                    
                    # Store the pattern
                    pattern_count[(orig, corr_text)] += 1
        
        return pattern_count
    
    def _create_rule(self, category: str, pattern: Tuple[str, str], occurrences: int) -> Dict:
        """
        Create a rule from a pattern.
        """
        original, corrected = pattern
        
        rule = {
            'rule_id': f'LEARNED-{category.upper()}-{abs(hash(pattern)) % 10000:04d}',
            'category': category.replace('_', ' ').title(),
            'severity': 'Medium',
            'description': self.rule_templates.get(category, 'Fix: "{original}" → "{corrected}"').format(
                original=original,
                corrected=corrected
            ),
            'details': {
                'pattern_type': category,
                'original_text': original,
                'corrected_text': corrected,
                'occurrences': occurrences,
                'learned_from': 'training_data',
                'confidence': min(occurrences / 10.0, 1.0)  # Confidence based on occurrences
            }
        }
        
        return rule


class PromptOptimizer:
    """
    Optimizes the AI system prompt based on learned corrections.
    """
    
    def __init__(self, current_prompt: str):
        self.current_prompt = current_prompt
        self.examples = []
    
    def add_training_examples(self, corrections: List[Dict]):
        """
        Add training examples from corrections.
        """
        for corr in corrections:
            if corr.get('type') == 'replacement':
                self.examples.append({
                    'input': corr['original'],
                    'output': corr['corrected'],
                    'category': corr.get('category', 'general')
                })
    
    def generate_enhanced_prompt(self, max_examples: int = 10) -> str:
        """
        Generate an enhanced prompt with learned examples.
        """
        # Count examples by category
        by_category = defaultdict(list)
        for ex in self.examples:
            by_category[ex['category']].append(ex)
        
        # Build examples section
        examples_text = "\n\nLEARNED EXAMPLES FROM TRAINING DATA:\n"
        
        example_count = 0
        for category in ['spelling', 'diacritics', 'separator', 'punctuation', 'price_format']:
            if category in by_category and example_count < max_examples:
                examples_text += f"\n{category.replace('_', ' ').title()}:\n"
                
                # Add up to 2 examples per category
                for ex in by_category[category][:2]:
                    examples_text += f'Input: "{ex["input"]}"\n'
                    examples_text += f'Output: "{ex["output"]}"\n\n'
                    example_count += 1
                    
                    if example_count >= max_examples:
                        break
        
        # Insert examples before the existing examples section
        enhanced_prompt = self.current_prompt
        if "EXAMPLES:" in enhanced_prompt:
            enhanced_prompt = enhanced_prompt.replace("EXAMPLES:", examples_text + "\n\nEXAMPLES:")
        else:
            enhanced_prompt += examples_text
        
        return enhanced_prompt


class TrainingPipeline:
    """
    Main training pipeline coordinator.
    """
    
    def __init__(self, training_data_dir: str = "tmp/training"):
        self.training_data_dir = Path(training_data_dir)
        self.training_data_dir.mkdir(parents=True, exist_ok=True)
        
        self.analyzer = TrainingPairAnalyzer()
        self.rule_generator = RuleGenerator()
        
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.session_file = self.training_data_dir / f"session_{self.session_id}.json"
        
        self.session_data = {
            'session_id': self.session_id,
            'pairs_processed': 0,
            'corrections_found': 0,
            'rules_generated': 0,
            'pairs': [],
            'all_corrections': [],
            'generated_rules': []
        }
    
    def ingest_document_pair(
        self, 
        original_path: str, 
        redlined_path: str
    ) -> Dict:
        """
        Ingest and analyze a single document pair.
        """
        print(f"\nProcessing pair:")
        print(f"  Original: {os.path.basename(original_path)}")
        print(f"  Redlined: {os.path.basename(redlined_path)}")
        
        analysis = self.analyzer.load_document_pair(original_path, redlined_path)
        
        # Update session stats
        self.session_data['pairs_processed'] += 1
        self.session_data['corrections_found'] += len(analysis['text_corrections'])
        self.session_data['pairs'].append({
            'original': original_path,
            'redlined': redlined_path,
            'corrections': len(analysis['text_corrections'])
        })
        
        # Store all corrections
        self.session_data['all_corrections'].extend(analysis['text_corrections'])
        
        print(f"  Found {len(analysis['text_corrections'])} text corrections")
        print(f"  Found {len(analysis['formatting_corrections'])} formatting corrections")
        
        return analysis
    
    def ingest_directory_pairs(
        self, 
        directory: str,
        original_pattern: str = "*original*.docx",
        redlined_pattern: str = "*redlined*.docx"
    ):
        """
        Ingest all document pairs from a directory.
        
        Expects files to follow naming convention:
        - original files contain 'original' in name
        - redlined files contain 'redlined' in name and match original name
        """
        dir_path = Path(directory)
        
        original_files = sorted(dir_path.glob(original_pattern))
        
        print(f"\nScanning directory: {directory}")
        print(f"Found {len(original_files)} original files")
        
        for orig_file in original_files:
            # Try to find matching redlined file
            base_name = orig_file.stem.replace('original', '').replace('_', '').strip()
            
            # Look for redlined version
            redlined_candidates = list(dir_path.glob(f"*{base_name}*redlined*.docx"))
            
            if not redlined_candidates:
                print(f"\nWarning: No redlined version found for {orig_file.name}")
                continue
            
            redlined_file = redlined_candidates[0]
            
            # Process the pair
            self.ingest_document_pair(str(orig_file), str(redlined_file))
    
    def generate_rules(self, min_occurrences: int = 2) -> List[Dict]:
        """
        Generate rules from all accumulated corrections.
        """
        print(f"\n{'='*60}")
        print("GENERATING RULES FROM TRAINING DATA")
        print(f"{'='*60}")
        print(f"Total corrections analyzed: {len(self.session_data['all_corrections'])}")
        
        rules = self.rule_generator.generate_rules_from_corrections(
            self.session_data['all_corrections'],
            min_occurrences=min_occurrences
        )
        
        self.session_data['generated_rules'] = rules
        self.session_data['rules_generated'] = len(rules)
        
        print(f"Generated {len(rules)} new rules")
        
        return rules
    
    def save_rules_to_file(self, output_path: str = None):
        """
        Save generated rules to a JSON file.
        """
        if output_path is None:
            output_path = str(self.training_data_dir / f"learned_rules_{self.session_id}.json")
        
        rules_data = {
            'generated_at': datetime.now().isoformat(),
            'session_id': self.session_id,
            'pairs_processed': self.session_data['pairs_processed'],
            'rules': self.session_data['generated_rules']
        }
        
        with open(output_path, 'w') as f:
            json.dump(rules_data, f, indent=2)
        
        print(f"\nRules saved to: {output_path}")
        return output_path
    
    def merge_with_existing_rules(self, existing_rules_path: str, output_path: str):
        """
        Merge generated rules with existing SOP rules.
        """
        # Load existing rules
        with open(existing_rules_path, 'r') as f:
            existing_data = json.load(f)
        
        # Add new rules
        existing_data['rules'].extend(self.session_data['generated_rules'])
        
        # Save merged rules
        with open(output_path, 'w') as f:
            json.dump(existing_data, f, indent=2)
        
        print(f"\nMerged rules saved to: {output_path}")
    
    def generate_optimized_prompt(self, current_prompt: str) -> str:
        """
        Generate an optimized prompt based on training data.
        """
        optimizer = PromptOptimizer(current_prompt)
        optimizer.add_training_examples(self.session_data['all_corrections'])
        
        enhanced_prompt = optimizer.generate_enhanced_prompt()
        
        # Save to file
        prompt_file = self.training_data_dir / f"optimized_prompt_{self.session_id}.txt"
        with open(prompt_file, 'w') as f:
            f.write(enhanced_prompt)
        
        print(f"\nOptimized prompt saved to: {prompt_file}")
        
        return enhanced_prompt
    
    def save_session(self):
        """
        Save the current training session data.
        """
        with open(self.session_file, 'w') as f:
            json.dump(self.session_data, f, indent=2)
        
        print(f"\nSession data saved to: {self.session_file}")
    
    def print_summary(self):
        """
        Print a summary of the training session.
        """
        print(f"\n{'='*60}")
        print("TRAINING SESSION SUMMARY")
        print(f"{'='*60}")
        print(f"Session ID: {self.session_id}")
        print(f"Document pairs processed: {self.session_data['pairs_processed']}")
        print(f"Total corrections found: {self.session_data['corrections_found']}")
        print(f"Rules generated: {self.session_data['rules_generated']}")
        
        # Category breakdown
        if self.session_data['all_corrections']:
            categories = Counter(c.get('category', 'unknown') 
                                for c in self.session_data['all_corrections'])
            
            print("\nCorrections by category:")
            for category, count in categories.most_common():
                print(f"  {category}: {count}")
        
        print(f"\n{'='*60}\n")


# CLI Interface
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Train the menu redliner from document pairs"
    )
    
    parser.add_argument(
        '--directory',
        '-d',
        help='Directory containing document pairs',
        required=True
    )
    
    parser.add_argument(
        '--min-occurrences',
        '-m',
        type=int,
        default=2,
        help='Minimum occurrences for a pattern to become a rule (default: 2)'
    )
    
    parser.add_argument(
        '--merge-rules',
        help='Path to existing rules file to merge with',
        default=None
    )
    
    parser.add_argument(
        '--optimize-prompt',
        action='store_true',
        help='Generate optimized AI prompt'
    )
    
    args = parser.parse_args()
    
    # Initialize pipeline
    pipeline = TrainingPipeline()
    
    # Ingest document pairs
    pipeline.ingest_directory_pairs(args.directory)
    
    # Generate rules
    pipeline.generate_rules(min_occurrences=args.min_occurrences)
    
    # Save rules
    rules_file = pipeline.save_rules_to_file()
    
    # Merge with existing rules if requested
    if args.merge_rules:
        output_path = args.merge_rules.replace('.json', '_updated.json')
        pipeline.merge_with_existing_rules(args.merge_rules, output_path)
    
    # Generate optimized prompt if requested
    if args.optimize_prompt:
        from ai_corrector import AICorrector
        corrector = AICorrector()
        pipeline.generate_optimized_prompt(corrector.system_prompt)
    
    # Save session and print summary
    pipeline.save_session()
    pipeline.print_summary()
    
    print("\n✓ Training complete!")
    print(f"  Review generated rules in: {rules_file}")

