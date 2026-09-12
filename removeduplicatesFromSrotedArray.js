// Input: arr[] = [2, 2, 2, 2, 2]
// Output: [2]
// Explanation: All the elements are 2, So only keep one instance of 2.

// Input: arr[] = [1, 2, 2, 3, 4, 4, 4, 5, 5]
// Output: [1, 2, 3, 4, 5]

// Input: arr[] = [1, 2, 3]
// Output: [1, 2, 3]
// Explanation : No change as all elements are distinct.
let arr = [2, 2, 3, 4, 4];

function removeDuplicatesFromArr(arr) {

    let j = 0;

    for (let i = 1; i < arr.length; i++) {

        if (arr[i] !== arr[j]) {
            j++;
            arr[j] = arr[i];
        }
    }

    return arr.slice(0, j + 1);
}

console.log(removeDuplicatesFromArr(arr));