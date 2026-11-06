from blackpy import Actor, stage

stage.background("city")
car = Actor("car", x=-260, y=-140, name="자동차")

stage.say("자동차가 얼마나 멀리 갈까요?")
car.forward(420)

stage.say("자동차가 멈췄어요!")
print("자동차의 멈춘 곳을 살펴보세요.")
