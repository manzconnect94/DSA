// set

var arr = [11, 2, 3, 4, 2, 2];

function removeDuplicates(arr) {
  return [...new Set(arr)];  //time complexity o(n)
}

console.log(removeDuplicates(arr));

// filter

function removeDuplicatesFilter(arr) {
  return arr.filter((value, index) => arr.indexOf(value) === index); //time complexity o(n*2)
}
function removeDuplicatesFilter1(arr) {
  return arr.filter((value, index) => !arr.indexOf(value));  //time complexity o(n*2)
}

console.log(removeDuplicatesFilter(arr));
console.log(removeDuplicatesFilter1(arr));

// forEach

function removeDuplicatesForEach(arr) {
  let unique = [];
   arr.forEach((value, index) => {
    if (arr.indexOf(value) === index) {  
      unique.push(value);
    } 
  });
  console.log(unique);
}
removeDuplicatesForEach(arr);  //time complexity o(n*2)

function removeDuplicatesForEach1(arr) {
    let unique = [];
     arr.forEach((value, index) => {
      if (!unique.includes(value)) {
        unique.push(value);
      }
    });
    console.log(unique);
  }
  removeDuplicatesForEach1(arr); //time complexity o(n*2)


  function removeDuplicatesReduce(arr) {
    return arr.reduce((acc, currValue) => {
      if (!acc.includes(currValue)) acc.push(currValue);
      return acc;
    }, []); // initial value supplied here
  }
  console.log(removeDuplicatesReduce(arr));


  Array.prototype.unique = function (){
    return Array.from(new Set(this));
  }

  console.log(arr.unique())