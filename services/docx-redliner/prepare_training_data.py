"""
Training Data Preparation Tool
===============================
Helps organize and prepare document pairs for training.

This tool helps you:
1. Organize scattered document pairs into a training directory
2. Validate that pairs are properly matched
3. Rename files to follow the naming convention
"""

import os
import shutil
from pathlib import Path
from typing import List, Tuple
import argparse


class TrainingDataPreparer:
    """
    Prepares and organizes training data from document pairs.
    """
    
    def __init__(self, output_dir: str = "tmp/training/pairs"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.pairs = []
    
    def add_pair_from_files(
        self, 
        original_path: str, 
        redlined_path: str,
        pair_name: str = None
    ):
        """
        Add a document pair to the training set.
        
        Args:
            original_path: Path to original document
            redlined_path: Path to redlined document
            pair_name: Optional name for the pair (auto-generated if None)
        """
        # Validate files exist
        if not os.path.exists(original_path):
            raise FileNotFoundError(f"Original file not found: {original_path}")
        
        if not os.path.exists(redlined_path):
            raise FileNotFoundError(f"Redlined file not found: {redlined_path}")
        
        # Generate pair name if not provided
        if pair_name is None:
            pair_name = f"pair_{len(self.pairs) + 1:03d}"
        
        # Copy files to output directory with standard naming
        original_dest = self.output_dir / f"{pair_name}_original.docx"
        redlined_dest = self.output_dir / f"{pair_name}_redlined.docx"
        
        shutil.copy2(original_path, original_dest)
        shutil.copy2(redlined_path, redlined_dest)
        
        self.pairs.append({
            'name': pair_name,
            'original': str(original_dest),
            'redlined': str(redlined_dest)
        })
        
        print(f"✓ Added pair '{pair_name}'")
    
    def auto_discover_pairs(self, directory: str) -> List[Tuple[str, str]]:
        """
        Automatically discover document pairs in a directory.
        
        Looks for files that might be pairs based on:
        - Similar names
        - Date/version patterns
        - Keywords like 'original', 'final', 'edited', 'redlined'
        """
        dir_path = Path(directory)
        all_files = list(dir_path.glob("*.docx"))
        
        # Filter out temp files
        all_files = [f for f in all_files if not f.name.startswith('~$')]
        
        discovered_pairs = []
        used_files = set()
        
        # Strategy 1: Look for explicit markers
        for file in all_files:
            if file in used_files:
                continue
            
            name_lower = file.name.lower()
            
            # Check if this looks like an original file
            if any(marker in name_lower for marker in ['original', 'submitted', 'draft']):
                # Try to find corresponding redlined version
                base_name = file.stem
                for marker in ['original', 'submitted', 'draft']:
                    base_name = base_name.replace(marker, '').replace('_', ' ').strip()
                
                # Look for redlined version
                for other_file in all_files:
                    if other_file in used_files or other_file == file:
                        continue
                    
                    other_lower = other_file.name.lower()
                    if any(marker in other_lower for marker in ['redlined', 'edited', 'final', 'reviewed']):
                        # Check if names are similar
                        if self._names_similar(file.stem, other_file.stem):
                            discovered_pairs.append((str(file), str(other_file)))
                            used_files.add(file)
                            used_files.add(other_file)
                            break
        
        # Strategy 2: Look for version numbers or dates
        for file in all_files:
            if file in used_files:
                continue
            
            # Try to find a file with similar name but different version/date
            for other_file in all_files:
                if other_file in used_files or other_file == file:
                    continue
                
                if self._likely_versions(file.name, other_file.name):
                    discovered_pairs.append((str(file), str(other_file)))
                    used_files.add(file)
                    used_files.add(other_file)
                    break
        
        return discovered_pairs
    
    def _names_similar(self, name1: str, name2: str, threshold: float = 0.6) -> bool:
        """Check if two filenames are similar."""
        # Simple character overlap check
        name1_clean = ''.join(c for c in name1.lower() if c.isalnum())
        name2_clean = ''.join(c for c in name2.lower() if c.isalnum())
        
        # Count common substrings
        common_length = sum(1 for c1, c2 in zip(name1_clean, name2_clean) if c1 == c2)
        max_length = max(len(name1_clean), len(name2_clean))
        
        if max_length == 0:
            return False
        
        similarity = common_length / max_length
        return similarity >= threshold
    
    def _likely_versions(self, name1: str, name2: str) -> bool:
        """Check if files look like different versions of the same document."""
        import re
        
        # Remove version indicators
        patterns = [
            r'v\d+',
            r'version\d+',
            r'\d{4}-\d{2}-\d{2}',  # dates
            r'\(\d+\)',  # (1), (2), etc.
            r'_\d+$',  # trailing numbers
        ]
        
        name1_base = name1.lower()
        name2_base = name2.lower()
        
        for pattern in patterns:
            name1_base = re.sub(pattern, '', name1_base)
            name2_base = re.sub(pattern, '', name2_base)
        
        # Clean up
        name1_base = ''.join(c for c in name1_base if c.isalnum())
        name2_base = ''.join(c for c in name2_base if c.isalnum())
        
        return name1_base == name2_base and name1_base != ''
    
    def interactive_pairing(self, directory: str):
        """
        Interactive mode to manually pair documents.
        """
        dir_path = Path(directory)
        all_files = sorted([f for f in dir_path.glob("*.docx") 
                          if not f.name.startswith('~$')])
        
        if not all_files:
            print(f"No .docx files found in {directory}")
            return
        
        print(f"\nFound {len(all_files)} documents:")
        for i, file in enumerate(all_files, 1):
            print(f"  {i}. {file.name}")
        
        print("\nEnter pairs of document numbers (original, redlined):")
        print("Example: 1,2 or 3,4")
        print("Type 'done' when finished, 'skip' to skip current, 'auto' for auto-discovery")
        print()
        
        while True:
            user_input = input("Enter pair (e.g., 1,2): ").strip().lower()
            
            if user_input == 'done':
                break
            elif user_input == 'skip':
                continue
            elif user_input == 'auto':
                print("\nAttempting auto-discovery...")
                auto_pairs = self.auto_discover_pairs(directory)
                print(f"Found {len(auto_pairs)} potential pairs")
                
                for orig, redl in auto_pairs:
                    print(f"\n  Original: {Path(orig).name}")
                    print(f"  Redlined: {Path(redl).name}")
                    confirm = input("  Add this pair? (y/n): ").strip().lower()
                    
                    if confirm == 'y':
                        pair_name = input("  Pair name (press Enter for auto): ").strip()
                        if not pair_name:
                            pair_name = None
                        self.add_pair_from_files(orig, redl, pair_name)
                
                break
            
            # Parse the input
            try:
                parts = user_input.split(',')
                if len(parts) != 2:
                    print("Please enter exactly two numbers separated by comma")
                    continue
                
                idx1, idx2 = int(parts[0].strip()) - 1, int(parts[1].strip()) - 1
                
                if idx1 < 0 or idx1 >= len(all_files) or idx2 < 0 or idx2 >= len(all_files):
                    print("Invalid file numbers")
                    continue
                
                original = all_files[idx1]
                redlined = all_files[idx2]
                
                print(f"\n  Original: {original.name}")
                print(f"  Redlined: {redlined.name}")
                confirm = input("  Correct? (y/n): ").strip().lower()
                
                if confirm == 'y':
                    pair_name = input("  Pair name (press Enter for auto): ").strip()
                    if not pair_name:
                        pair_name = None
                    
                    self.add_pair_from_files(str(original), str(redlined), pair_name)
                
            except ValueError:
                print("Please enter valid numbers")
                continue
    
    def summary(self):
        """Print summary of prepared training data."""
        print(f"\n{'='*60}")
        print("TRAINING DATA PREPARATION SUMMARY")
        print(f"{'='*60}")
        print(f"Pairs prepared: {len(self.pairs)}")
        print(f"Output directory: {self.output_dir}")
        print(f"\nReady to train with:")
        print(f"  ./batch_train.sh {self.output_dir}")
        print(f"{'='*60}\n")


# CLI Interface
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Prepare training data from document pairs"
    )
    
    parser.add_argument(
        '--directory',
        '-d',
        help='Directory containing document files',
        required=True
    )
    
    parser.add_argument(
        '--output',
        '-o',
        help='Output directory for organized pairs',
        default='tmp/training/pairs'
    )
    
    parser.add_argument(
        '--interactive',
        '-i',
        action='store_true',
        help='Use interactive mode to manually pair documents'
    )
    
    parser.add_argument(
        '--auto',
        '-a',
        action='store_true',
        help='Automatically discover and pair documents'
    )
    
    args = parser.parse_args()
    
    # Initialize preparer
    preparer = TrainingDataPreparer(output_dir=args.output)
    
    if args.interactive:
        # Interactive mode
        preparer.interactive_pairing(args.directory)
    elif args.auto:
        # Auto discovery mode
        print("Auto-discovering document pairs...")
        pairs = preparer.auto_discover_pairs(args.directory)
        
        print(f"\nFound {len(pairs)} potential pairs:")
        for i, (orig, redl) in enumerate(pairs, 1):
            print(f"\n{i}. {Path(orig).name}")
            print(f"   {Path(redl).name}")
        
        if pairs:
            confirm = input("\nAdd all pairs? (y/n): ").strip().lower()
            if confirm == 'y':
                for orig, redl in pairs:
                    preparer.add_pair_from_files(orig, redl)
    else:
        print("Please specify --interactive or --auto mode")
        print("Run with --help for more information")
        exit(1)
    
    # Print summary
    preparer.summary()

